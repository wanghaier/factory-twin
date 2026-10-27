<script setup>
import { computed, ref, watch } from 'vue'

import { useBabylonScene } from './platform/engine/useBabylonScene.js'
import { createRuntime } from './platform/engine/createRuntime.js'
import { applyOfflineConfig } from './platform/engine/offlineConfig.js'
import { loadScene } from './platform/loader/loadScene.js'
import { createModuleRegistry } from './platform/registry/moduleRegistry.js'
import { buildTree } from './platform/scene/treeModel.js'
import { createSelectionManager } from './platform/selection/selectionManager.js'
import { attachPickSelection } from './platform/interaction/pickSelection.js'
import { createSelectionHighlight } from './platform/interaction/selectionHighlight.js'
import { createTransformGizmo } from './platform/editor/transformGizmo.js'
import { applyTransformValue, writeTransformToDocument } from './platform/editor/transformSync.js'
import { applyMaterialChange } from './platform/editor/materialSync.js'
import { canDeleteNode, disposeEngineNode, renameNode } from './platform/editor/nodeEdit.js'
import { appendNodeToDocument, createResourceLibrary, removeNodeFromDocument } from './platform/editor/resourceLibrary.js'
import { createSceneFocus } from './platform/editor/sceneFocus.js'
import { createDetailSwap } from './platform/editor/detailSwap.js'
import { createMockDataSource } from './platform/data/mockDataSource.js'
import { buildMonitoringView, pushTrend } from './platform/data/monitoring.js'
import { summarizeLeakPoints } from './platform/schema/validateScene.js'
import { applyModelNodeTransform, extensionOf, importModelFromFile, importModelFromUrl, SUPPORTED_EXTENSIONS } from './platform/editor/importModel.js'
import { captureCameraPreset, scaleCameraDistance, updateCameraPreset } from './platform/scene/cameraMath.js'
import { collectLocalResources, downloadScene, parseScene, sceneFileName, serializeScene } from './platform/editor/sceneIO.js'
import { createIndexedDbBackend, createSceneStorage } from './platform/storage/sceneStorage.js'
import SceneTree from './platform/components/SceneTree.vue'
import PropertyPanel from './platform/components/PropertyPanel.vue'
import ResourcePanel from './platform/components/ResourcePanel.vue'
import SceneFilePanel from './platform/components/SceneFilePanel.vue'
import CameraPanel from './platform/components/CameraPanel.vue'
import MonitoringPanel from './platform/components/MonitoringPanel.vue'
import PointEditorPanel from './platform/components/PointEditorPanel.vue'
import AppMenu from './platform/components/AppMenu.vue'
import MaintenanceDialog from './platform/components/MaintenanceDialog.vue'
import { addPointToDocument, buildPointDraft } from './platform/editor/pointEditor.js'
import { parsePointCode } from './platform/data/pointCode.js'
import { createHistory } from './platform/editor/history.js'
import { applyMaintenanceRecord, updatePointValue } from './platform/editor/pointEditor.js'
import { buildImportMeta, computeNormalizedScale, computeScaleByMaxDimension, shouldSuggestSimplify } from './platform/editor/modelNormalize.js'
import { createSceneFreezer } from './platform/editor/sceneFreezer.js'
import { triangleCountOf } from './platform/interaction/pickThrottle.js'
import { roundPosition } from './platform/editor/pointPlacement.js'
import { buildPointAutofill } from './platform/editor/pointAutofill.js'
import { repairDuplicateNodeIds } from './platform/editor/sceneRepair.js'
import { createFactoryModules } from './app/modules/index.js'

const SCENE_URL = `${import.meta.env.BASE_URL}scenes/demo-factory.json`

const sceneName = ref('')
const stats = ref({ nodeCount: 0, deviceCount: 0, pointCount: 0 })
const summary = ref({ total: 0, normal: 0, warn: 0, exceed: 0, pending: 0 })
const loadedModules = ref([])
const activeCamera = ref('')
const deviceAlpha = ref(0.85)

// 层级树与属性面板共用同一份选中状态
const treeItems = ref([])
const selectedNodeId = ref('')
const selectedNode = ref(null)
const selectedDevice = ref(null)
const selectedPoints = ref([])
const gizmoMode = ref('translate')
const gizmoSupported = ref(false)
/** 编辑版本号：gizmo 拖动或数值输入后自增，驱动属性面板重算 */
const editRevision = ref(0)
const resources = ref([])
const importBusy = ref(false)
const importNotice = ref('')
const storageKind = ref('none')
const savedAt = ref('')
const sceneNotice = ref('')
const cameraPresets = ref([])
const cameraEditId = ref('camera-overview')
const editingCamera = computed(() => {
  void editRevision.value
  const cameras = handle.value?.document?.cameras ?? []
  return cameras.find((camera) => camera.id === cameraEditId.value) ?? null
})
const loadProgress = ref('')
const loadMs = ref(0)
const dataKind = ref('')
const lastUpdate = ref('')
const monitoring = ref(null)
const selectedPointId = ref('')
const pointEditorRef = ref(null)
const pointSuggestion = ref({ segments: {}, position: null, deviceId: '' })
const pointSequenceHint = ref('')
const pointNotice = ref('')
const pointError = ref('')
const placingPoint = ref(false)
const pendingPosition = ref(null)
const pointTargetNodeId = ref('')
const deviceOptions = ref([])
const failedModels = ref([])
const history = createHistory({ limit: 30 })
const canUndo = ref(false)
const canRedo = ref(false)
const historyNotice = ref('')
/** 面板显隐：不常用的三块默认收起，从左上角菜单打开 */
const panelVisible = ref({ camera: false, resource: false, sceneFile: false, pointEditor: true, layout: true, monitoring: true, diagnostics: true })

function togglePanel(key) {
  panelVisible.value = { ...panelVisible.value, [key]: !panelVisible.value[key] }
}

/** 维修记录弹窗状态 */
const maintenanceOpen = ref(false)
const maintenancePoint = ref(null)
const maintenanceError = ref('')
/** 当前展开的下拉：'menu' / 'tree' / ''；两者互斥，因此永远不会互相遮挡 */
const activeDropdown = ref('')
const lastMaintenanceOperator = ref('')

function toggleDropdown(key) {
  activeDropdown.value = activeDropdown.value === key ? '' : key
}

// 点击顶部栏以外区域自动收起下拉
if (typeof window !== 'undefined') {
  window.addEventListener('click', (event) => {
    if (!activeDropdown.value) return
    const topbar = document.querySelector('.hud--top')
    if (topbar && topbar.contains(event.target)) return
    activeDropdown.value = ''
  })
}

function onUpdatePpm(row, value) {
  const current = handle.value
  const point = (current?.document?.leakPoints ?? []).find((item) => item.id === row.id)
  if (!point) return
  recordHistory('修改检测值')
  const result = updatePointValue(point, value)
  if (!result.ok) {
    pointError.value = result.message
    return
  }
  pointError.value = ''
  current.services?.leakMarkers?.update?.([{ pointId: point.id, ppm: point.ppm, level: point.level }])
  current.refreshMonitoring?.()
  editRevision.value += 1
}

function onOpenMaintenance(row) {
  const current = handle.value
  const point = (current?.document?.leakPoints ?? []).find((item) => item.id === row.id)
  if (!point) return
  maintenanceError.value = ''
  maintenancePoint.value = point
  maintenanceOpen.value = true
}

function onCloseMaintenance() {
  maintenanceOpen.value = false
  maintenanceError.value = ''
}

function onSaveMaintenance(record) {
  const current = handle.value
  const point = maintenancePoint.value
  if (!point) return
  recordHistory('保存维修记录')
  const result = applyMaintenanceRecord(point, record)
  if (!result.ok) {
    maintenanceError.value = result.message
    return
  }
  current.services?.leakMarkers?.update?.([{ pointId: point.id, ppm: point.ppm, level: point.level }])
  current.refreshMonitoring?.()
  editRevision.value += 1
  maintenanceError.value = ''
  maintenanceOpen.value = false
}

/** 维修照片存到本地（IndexedDB），场景 JSON 只保留引用信息 */
async function onPickPhoto(file) {
  const current = handle.value
  if (!current?.storage || !file) return
  try {
    await current.storage.saveResource(`photo:${file.name}`, file, { name: file.name, size: file.size, at: new Date().toISOString() })
    pointNotice.value = `照片已保存到本地：${file.name}`
  } catch (error) {
    pointError.value = `照片保存失败：${error?.message ?? error}`
  }
}

/** 左上角菜单命令分发：复用已有函数，菜单只做入口 */
function onMenuCommand(command) {
  if (command.startsWith('panel.')) {
    const key = command.slice('panel.'.length)
    panelVisible.value = { ...panelVisible.value, [key]: !panelVisible.value[key] }
    return
  }
  const actions = {
    'scene.export': onExportScene,
    'scene.reset': onResetScene,
    'edit.undo': undoEdit,
    'edit.redo': redoEdit,
    'edit.delete': onDeleteNode,
    'edit.cleanup': onCleanupFailedModels,
    'resource.sample': placeSampleModel,
    'help.diagnostics': () => {
      panelVisible.value = { ...panelVisible.value, diagnostics: !panelVisible.value.diagnostics }
    },
  }
  const action = actions[command]
  if (action) action()
}
/** 本地存档比程序内置场景旧时提示升级（否则用户会一直看到旧场景，误以为程序没更新） */
const upgradeNotice = ref('')
/** 运行期诊断：黑屏时用来判断是"没渲染"还是"渲染成黑色" */
const diagnostics = ref(null)
/** 分阶段进度：卡住时能一眼看出停在哪一步 */
const stage = ref('启动')

/** 存储后端只需初始化一次（IndexedDB 不可用时降级为"不持久化"） */
let storagePromise = null
/** 存储初始化/读取的超时上限：宁可失去持久化，也不能让页面卡在"加载中" */
const STORAGE_TIMEOUT_MS = 1500

function withTimeout(promise, fallback, ms = STORAGE_TIMEOUT_MS) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))])
}

function getStorage() {
  if (!storagePromise) {
    storagePromise = withTimeout(
      createIndexedDbBackend().then((backend) => createSceneStorage(backend)),
      createSceneStorage(null),
    ).catch(() => createSceneStorage(null))
  }
  return storagePromise
}

const registry = createModuleRegistry(createFactoryModules())

/** 统计场景里的模型节点数（升级提示文案用） */
function countModelNodes(document) {
  const walk = (nodes) => (nodes ?? []).reduce((sum, node) => sum + (node.type === 'model' ? 1 : 0) + walk(node.children), 0)
  return walk(document.nodes)
}

/**
 * 组装流程：拉取场景 JSON → 创建运行时 → 加载场景 → 初始化业务模块 → 接上选中联动
 * 换一份场景 JSON 就换一个场景，这里不需要改任何一行。
 */
async function createScene(canvas, { onFps, onError }) {
  stage.value = '读取本地存档'
  const storage = await getStorage()
  storageKind.value = storage.kind

  // 优先用本地存档：这样刷新后能回到上次编辑的状态
  const saved = await withTimeout(storage.loadScene(), null)
  let restoredFromSave = false
  let document
  if (saved) {
    document = saved
    restoredFromSave = true
    // 比对内置场景日期：内置更新说明程序升级了，但本地存档会把它盖住，必须提示
    try {
      const packagedResponse = await fetch(SCENE_URL)
      if (packagedResponse.ok) {
        const packaged = await packagedResponse.json()
        const packagedAt = packaged.meta?.createdAt ?? ''
        const savedAt = saved.meta?.createdAt ?? ''
        if (packagedAt > savedAt) {
          upgradeNotice.value = `你看到的是本地存档（${savedAt || '旧版本'}）；程序内置的新版场景是 ${packagedAt}，含 ${countModelNodes(packaged)} 个厂区模型`
        }
      }
    } catch {
      // 比对失败不影响主流程
    }
  } else {
    stage.value = '加载场景文件'
    const response = await fetch(SCENE_URL)
    if (!response.ok) throw new Error(`场景文件加载失败：HTTP ${response.status}（${SCENE_URL}）`)
    document = await response.json()
  }

  // 自动修复旧场景里的重复节点 id（否则校验失败、应用无法加载）
  const repair = repairDuplicateNodeIds(document)
  if (repair.changed) {
    sceneNotice.value = `已自动修复 ${repair.renamed.length} 处重复节点 id`
    if (saved) await storage.saveScene(document)
  }

  stage.value = '创建渲染运行时'
  // 离线收口：把 Babylon 的 CDN 解码器地址改成本地路径（内网环境必需）
  await applyOfflineConfig()
  const runtime = createRuntime(canvas, { environment: document.environment ?? {}, onFps, onError })
  const loadStartedAt = performance.now()
  stage.value = '加载场景内容'
  const sceneHandle = await loadScene(runtime.engine, runtime.scene, document, {
    onProgress: ({ loaded, total }) => {
      loadProgress.value = `加载模型 ${loaded}/${total}`
      stage.value = `加载模型 ${loaded}/${total}`
    },
  })
  loadMs.value = Math.round(performance.now() - loadStartedAt)
  loadProgress.value = ''
  // 等一帧之后再采样诊断信息，确保渲染循环已经跑过
  setTimeout(() => {
    diagnostics.value = runtime.diagnostics()
  }, 1200)

  stage.value = '初始化业务模块'
  const services = {}
  const modules = await registry.setupAll({
    engine: runtime.engine,
    scene: runtime.scene,
    document,
    onCleanup: runtime.onCleanup,
    services,
    ...sceneHandle,
  })

  // 层级树（导入新模型后需要重建）
  let tree = buildTree(document)
  const refreshTree = () => {
    tree = buildTree(document)
    treeItems.value = tree.flat
  }
  refreshTree()

  const refreshCameraPresets = () => {
    cameraPresets.value = (document.cameras ?? []).map((camera) => ({ id: camera.id, name: camera.name ?? camera.id }))
  }
  refreshCameraPresets()

  // 从存档恢复时，导入过的本地模型要从 IndexedDB 里取回来重新载入
  if (restoredFromSave) {
    for (const item of collectLocalResources(document)) {
      const blob = await storage.loadResource(item.uri)
      if (!blob) {
        sceneNotice.value = `本地模型缺失：${item.uri}（需重新导入该模型）`
        continue
      }
      for (const nodeId of item.nodeIds) {
        const documentNode = tree.index.get(nodeId)?.source
        if (!documentNode) continue
        try {
          const imported = await importModelFromFile(runtime.scene, blob, { nodeId, extension: item.format })
          // 重启恢复与首次导入使用同一套变换：位置、旋转、缩放和底部贴地缺一不可
          applyModelNodeTransform(imported.root, documentNode.transform ?? {}, {
            alignBottom: documentNode.anchor !== 'center',
          })
          sceneHandle.nodesById.set(nodeId, imported.root)
        } catch (error) {
          console.warn('[restore] 模型还原失败', nodeId, error)
        }
      }
    }
    sceneNotice.value = '已恢复到上次保存的场景'
  }

  // 自动存档：editRevision 每次自增后 600ms 落盘一次，避免频繁写
  let saveTimer = null
  function scheduleSave() {
    if (!storage.available) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      try {
        await storage.saveScene(document)
        savedAt.value = `已保存 ${new Date().toLocaleTimeString()}`
      } catch (e) {
        sceneNotice.value = `保存失败：${e?.message ?? e}`
      }
    }, 600)
  }

  // 选中联动：3D 拾取与层级树点击写入同一个状态源，订阅者负责刷新 UI 与描边
  const selection = createSelectionManager()
  const highlight = createSelectionHighlight(runtime.scene)
  const gizmo = createTransformGizmo(runtime.scene)
  const sceneFocus = createSceneFocus({ scene: runtime.scene, nodesById: sceneHandle.nodesById, document })
  const detailSwap = createDetailSwap({ scene: runtime.scene, nodesById: sceneHandle.nodesById, document })
  const sceneFreezer = createSceneFreezer()
  gizmoSupported.value = gizmo.supported
  gizmo.setMode(gizmoMode.value)
  // 拖动 gizmo 结束后，把引擎里的变换写回场景 JSON 数据
  gizmo.onChange(() => {
    // 正在拾取点位时，gizmo 拖动的是"待放置点"，不写回场景节点
    if (placingPoint.value && pendingMarker) {
      onScenePointPicked([pendingMarker.position.x, pendingMarker.position.y, pendingMarker.position.z])
      return
    }
    const nodeId = selection.getCurrent()
    const engineNode = nodeId ? sceneHandle.nodesById.get(nodeId) : null
    const documentNode = nodeId ? tree.index.get(nodeId)?.source : null
    if (!engineNode || !documentNode) return
    writeTransformToDocument(documentNode, engineNode)
    editRevision.value += 1
  })
  const deviceByNode = new Map(sceneHandle.devices.map((device) => [device.nodeRef, device]))

  const unsubscribe = selection.subscribe(({ nodeId }) => {
    // 静态冻结：选中对象解冻（可编辑），其余保持冻结以降低每帧开销
    if (nodeId) sceneFreezer.unfreeze(sceneHandle.nodesById.get(nodeId))
    selectedNodeId.value = nodeId ?? ''
    selectedNode.value = nodeId ? tree.index.get(nodeId)?.source ?? null : null
    const device = nodeId ? deviceByNode.get(nodeId) ?? null : null
    selectedDevice.value = device
    selectedPoints.value = device ? sceneHandle.leakPoints.filter((point) => point.deviceRef === device.id) : []
    highlight.apply(nodeId ? sceneHandle.nodesById.get(nodeId) : null)
    gizmo.attach(nodeId ? sceneHandle.nodesById.get(nodeId) : null)

    // 选中装置时丝滑聚焦到它的相机预设（没有预设的装置只选中、不移动镜头）
    const focusedDevice = nodeId ? deviceByNode.get(nodeId) : null
    if (focusedDevice?.cameraRef) sceneHandle.focusCameraPreset(focusedDevice.cameraRef)

    // 聚焦淡化：选中即淡化其它分支，取消选择即恢复
    if (nodeId) sceneFocus.focus(nodeId)
    else sceneFocus.reset()

    refreshMonitoring()
    refreshPointSuggestion()

    // 精细模型按需加载：只留当前装置的精细档，切走就释放（M4.3）
    if (nodeId && detailSwap.hasDetail(nodeId)) {
      detailSwap.releaseOthers(nodeId)
      if (!detailSwap.isLoaded(nodeId)) {
        sceneNotice.value = '正在加载该装置的精细模型…'
        detailSwap.load(nodeId).then((result) => {
          if (result.status === 'loaded') sceneNotice.value = `已加载精细模型（${result.meshes} 个网格）`
          else if (result.status === 'failed') sceneNotice.value = `精细模型加载失败，已保留轻量版本：${result.message}`
        })
      }
    } else {
      detailSwap.releaseAll()
    }
  })

  let pendingMarker = null
  const showPendingAt = (position) => {
    if (!pendingMarker) pendingMarker = services.leakMarkers?.addPending?.(position) ?? null
    else pendingMarker.position.set(position[0], position[1], position[2])
    gizmo.attach(pendingMarker)
    gizmo.setMode('translate')
    return pendingMarker
  }
  const clearPendingPoint = () => {
    if (pendingMarker) {
      services.leakMarkers?.removePending?.(pendingMarker)
      pendingMarker = null
    }
    gizmo.detach()
  }

  const stopPick = attachPickSelection(runtime.scene, {
    resolve(mesh) {
      const meta = mesh.metadata ?? {}
      if (meta.nodeId) return meta.nodeId
      // 点到点位标记时，选中该点位所属的装置
      if (meta.pointId) {
        const point = sceneHandle.leakPoints.find((item) => item.id === meta.pointId)
        return deviceByNode.get(point?.deviceRef)?.nodeRef ?? null
      }
      return typeof mesh.parent?.metadata?.nodeId === 'string' ? mesh.parent.metadata.nodeId : null
    },
    onPick(nodeId, mesh, pickInfo) {
      // 拾取模式：在模型表面取点，不触发普通选中
      if (placingPoint.value && pickInfo?.pickedPoint) {
        const hit = [pickInfo.pickedPoint.x, pickInfo.pickedPoint.y, pickInfo.pickedPoint.z]
        // 点击装置模型时自动关联该装置；新导入模型会在保存时自动登记为检测装置
        if (nodeId && tree.index.get(nodeId)?.source?.type === 'model') {
          const rounded = roundPosition(hit)
          if (rounded) refreshPointSuggestion(nodeId, rounded)
        }
        showPendingAt(hit)
        onScenePointPicked(hit)
        return
      }
      if (nodeId) selection.select(nodeId, 'scene')
      else selection.clear('scene')
    },
  })

  // 资源库：登记资源 → 追加场景节点 → 载入引擎 → 自动选中
  const resourceLibrary = createResourceLibrary()
  const resourceFiles = new Map()
  let placedCount = 0
  const countModelNodes = () => (document.nodes ?? []).filter((node) => node.type === 'model').length

  async function placeResource(resource, source = {}) {
    importBusy.value = true
    importNotice.value = ''
    const documentNode = resourceLibrary.buildNode(resource, Math.max(placedCount, countModelNodes()))
    // 保证节点 id 唯一（资源计数器每次启动从 1 开始，跨会话导入会撞 id）
    const existingIds = new Set()
    const collectIds = (nodes) => { for (const node of nodes ?? []) { existingIds.add(node.id); collectIds(node.children) } }
    collectIds(document.nodes)
    if (existingIds.has(documentNode.id)) {
      let suffix = 2
      while (existingIds.has(`${documentNode.id}-${suffix}`)) suffix += 1
      documentNode.id = `${documentNode.id}-${suffix}`
    }
    appendNodeToDocument(document, documentNode)
    refreshTree()
    try {
      const imported = source.file
        ? await importModelFromFile(runtime.scene, source.file, { nodeId: documentNode.id })
        : await importModelFromUrl(runtime.scene, source.url ?? resource.uri, { nodeId: documentNode.id, name: resource.name })

      // 尺寸归一化：按包围盒高度换算缩放（默认目标高度 2.5 米），替代"固定放大 15 倍"
      const importOptions = source.options ?? {}
      const autoNormalize = importOptions.autoNormalize !== false
      const basis = importOptions.normalizeBasis === 'height' ? 'height' : 'maxDimension'
      const targetSize = Number(importOptions.targetSize) || 15
      let appliedScale = 1
      let originalHeight = 0
      let originalMaxDimension = 0
      let triangles = 0
      for (const mesh of imported.meshes ?? []) {
        triangles += triangleCountOf(mesh)
        mesh.computeWorldMatrix?.(true)
        const box = mesh.getBoundingInfo?.()?.boundingBox
        if (box) {
          originalHeight = Math.max(originalHeight, box.maximumWorld.y - box.minimumWorld.y)
          const size = box.maximumWorld.subtract(box.minimumWorld)
          originalMaxDimension = Math.max(originalMaxDimension, size.x, size.y, size.z)
        }
      }
      if (autoNormalize) {
        appliedScale = basis === 'height'
          ? (computeNormalizedScale(originalHeight, targetSize) ?? 1)
          : (computeScaleByMaxDimension(originalMaxDimension, targetSize) ?? 1)
      }

      documentNode.transform.scale = [appliedScale, appliedScale, appliedScale]
      // 首次放置和重启恢复共用同一条变换链路，避免保存值与实际画面不一致
      applyModelNodeTransform(imported.root, documentNode.transform, {
        alignBottom: documentNode.anchor !== 'center',
      })
      documentNode.importMeta = buildImportMeta({
        basis,
        targetSize,
        targetHeight: originalHeight * appliedScale,
        appliedScale,
        sourceTriangles: triangles,
        sourceBytes: source.file?.size ?? 0,
        autoNormalized: autoNormalize,
      })
      sceneHandle.nodesById.set(documentNode.id, imported.root)
      sceneFreezer.freeze(imported.root)
      placedCount += 1
      refreshTree()
      selection.select(documentNode.id, 'import')
      editRevision.value += 1
      importNotice.value = `已放置：${resource.name}${autoNormalize ? `（自动缩放 ×${appliedScale}，${basis === 'height' ? `原始高 ${originalHeight.toFixed(3)} m → ${targetSize} m` : `原始最长边 ${originalMaxDimension.toFixed(3)} m → ${targetSize} m`}）` : ''}`
      if (shouldSuggestSimplify({ triangles, bytes: source.file?.size ?? 0 })) {
        importNotice.value += ` ⚠ 约 ${Math.round(triangles / 10000)} 万面，建议简化`
      }
    } catch (e) {
      // 导入失败要回滚场景数据，避免留下空节点
      removeNodeFromDocument(document, documentNode.id)
      refreshTree()
      importNotice.value = `导入失败：${e?.message ?? e}`
    } finally {
      importBusy.value = false
      resources.value = resourceLibrary.list()
    }
  }

  async function importFiles(files, options = {}) {
    for (const file of files ?? []) {
      const extension = extensionOf(file.name)
      if (!SUPPORTED_EXTENSIONS.includes(extension)) {
        importNotice.value = `不支持的格式：${file.name}（只支持 glb / gltf）`
        continue
      }
      const resource = resourceLibrary.add({ name: file.name, uri: file.name, format: extension, size: file.size, source: 'upload' })
      resourceFiles.set(resource.id, file)
      // 把文件本体存进 IndexedDB：刷新后仍能还原这个模型
      await storage.saveResource(file.name, file, { name: file.name, format: extension, size: file.size })
      await placeResource(resource, { file, options })
    }
  }

  function placeSample() {
    // 内置示例模型：左右法兰 + 中间压盖填料（此前指向的 sample-box 已移出应用）
    const resource = resourceLibrary.add({ name: '示例装置（法兰+压盖填料）', uri: 'models/flange-pair-gland.glb', format: 'glb', source: 'builtin' })
    return placeResource(resource, { url: 'models/flange-pair-gland.glb', options: { autoNormalize: false } })
  }

  /** 重命名当前选中节点：只改展示名，id 保持稳定（引用关系不受影响） */
  function renameSelected(nextName) {
    const nodeId = selection.getCurrent()
    if (!nodeId) return null
    const documentNode = tree.index.get(nodeId)?.source
    const renamed = renameNode(documentNode, sceneHandle.nodesById.get(nodeId), nextName)
    if (renamed) {
      // 同步装置记录的名称：装置卡、告警、监控面板用的都是 device.name，
      // 只改 node.name 会出现"树上是新名字、面板上还是旧名字"的不一致
      const device = deviceByNode.get(nodeId)
      if (device) {
        device.name = renamed
        deviceOptions.value = sceneHandle.devices.map((item) => ({ id: item.id, name: item.name, code: item.code ?? '' }))
      }
      refreshTree()
      refreshMonitoring()
      editRevision.value += 1
      importNotice.value = `已重命名为：${renamed}`
    }
    return renamed
  }

  /** 删除当前选中节点：先解除选中，再释放引擎对象，最后从场景数据里摘掉 */
  function deleteSelected() {
    const nodeId = selection.getCurrent()
    if (!nodeId) return false
    const documentNode = tree.index.get(nodeId)?.source
    if (!documentNode) return false

    const label = documentNode.name ?? nodeId
    // 有装置或点位引用时不允许删除，否则会写出自相矛盾的场景文件
    const check = canDeleteNode(document, nodeId)
    if (!check.ok) {
      importNotice.value = `无法删除「${label}」：${check.reason}`
      return false
    }
    if (typeof window !== 'undefined' && !window.confirm(`确定删除「${label}」吗？`)) return false

    selection.clear('delete')
    disposeEngineNode(sceneHandle.nodesById.get(nodeId))
    sceneHandle.nodesById.delete(nodeId)
    removeNodeFromDocument(document, nodeId)
    refreshTree()
    editRevision.value += 1
    importNotice.value = `已删除：${label}`
    return true
  }

  sceneName.value = document.meta?.name ?? ''
  stage.value = '就绪'
  stats.value = sceneHandle.stats
  let lastSnapshot = null
  let trendBuffer = []
  /** 监控面板视图：场景数据 + 最新快照 + 趋势 → 面板直接渲染的结构（纯函数在 monitoring.js） */
  const refreshMonitoring = () => {
    const nodeId = selection.getCurrent()
    monitoring.value = buildMonitoringView({
      document,
      snapshot: lastSnapshot,
      selectedDeviceId: nodeId ? deviceByNode.get(nodeId)?.id ?? '' : '',
      trend: trendBuffer,
    })
  }
  /** 供面板调用：按装置 id 选中并聚焦（复用已有选中链路，相机 / 淡化 / 精细档都会跟着走） */
  const focusDeviceById = (deviceId) => {
    const device = sceneHandle.devices.find((item) => item.id === deviceId)
    if (!device) return false
    selection.select(device.nodeRef, 'monitoring')
    return true
  }

  deviceOptions.value = sceneHandle.devices.map((device) => ({ id: device.id, name: device.name, code: device.code ?? '' }))
  failedModels.value = [...(sceneHandle.stats.failedModels ?? [])]

  /** 基于当前选中对象推导编号前缀与坐标；新导入模型也可作为自动创建的检测装置 */
  const refreshPointSuggestion = (nodeId = selection.getCurrent(), positionOverride = null) => {
    const sourceNode = nodeId ? tree.index.get(nodeId)?.source : null
    const device = nodeId
      ? deviceByNode.get(nodeId) ?? (sourceNode?.type === 'model'
        ? { id: `device-auto-${nodeId}`, name: sourceNode.name ?? nodeId, nodeRef: nodeId, status: 'running' }
        : null)
      : null
    const owned = device ? (document.leakPoints ?? []).filter((point) => point.deviceRef === device.id && point.code) : []
    const sampleCode = owned[0]?.code ?? ''
    const sampleSegments = sampleCode ? parsePointCode(sampleCode).segments : {}
    const autofill = buildPointAutofill({
      points: document.leakPoints ?? [],
      preferredSegments: sampleSegments,
      deviceName: device?.name ?? '',
      partType: 'F',
    })
    const engineNode = nodeId ? sceneHandle.nodesById.get(nodeId) : null
    const position = positionOverride ?? (engineNode
      ? [Number(engineNode.position.x.toFixed(2)), Number((engineNode.position.y + 1).toFixed(2)), Number(engineNode.position.z.toFixed(2))]
      : null)
    pointSuggestion.value = {
      segments: autofill.segments,
      position,
      deviceId: device?.id ?? '',
      suggestedName: autofill.suggestedName,
    }
    pointSequenceHint.value = device ? autofill.segments.sequence : ''
    pointTargetNodeId.value = device ? nodeId : ''
  }
  // 表单打开即有完整默认值；用户点击其他模型后会自动切换到对应装置
  refreshPointSuggestion(sceneHandle.devices[0]?.nodeRef ?? null)

  /** 保存点位前把"新导入模型"登记成正式检测装置，保证 deviceRef 不会悬空 */
  const ensurePointDevice = (draft, nodeId) => {
    if (!draft || !nodeId) return null
    const sourceNode = tree.index.get(nodeId)?.source
    if (!sourceNode || sourceNode.type !== 'model') return null

    let device = deviceByNode.get(nodeId)
    if (!device) {
      device = {
        id: draft.deviceRef || `device-auto-${nodeId}`,
        name: sourceNode.name ?? nodeId,
        nodeRef: nodeId,
        cameraRef: '',
        status: 'running',
      }
      document.devices = [...(document.devices ?? []), device]
      sceneHandle.devices.push(device)
      deviceByNode.set(nodeId, device)
      deviceOptions.value = sceneHandle.devices.map((item) => ({ id: item.id, name: item.name, code: item.code ?? '' }))
    }
    draft.deviceRef = device.id
    return device
  }

  /** 新增点位：写场景 + 补 3D 标记 + 刷新台账与提示 */
  const addDetectionPoint = (draft) => {
    const result = addPointToDocument(document, draft)
    if (!result.ok) return result
    services.leakMarkers?.add?.(draft)
    refreshMonitoring()
    refreshPointSuggestion(pointTargetNodeId.value || selection.getCurrent())
    editRevision.value += 1
    return result
  }

  const nextPointSequence = () => pointSequenceHint.value

  /** 清理素材缺失的节点：从场景数据与引擎里一并移除 */
  const cleanupFailedModels = () => {
    const targets = [...(sceneHandle.stats.failedModels ?? [])]
    for (const nodeId of targets) {
      const documentNode = tree.index.get(nodeId)?.source
      if (!documentNode) continue
      const check = canDeleteNode(document, nodeId)
      if (!check.ok) continue // 被装置/点位引用的节点不删，避免悬空引用
      disposeEngineNode(sceneHandle.nodesById.get(nodeId))
      sceneHandle.nodesById.delete(nodeId)
      removeNodeFromDocument(document, nodeId)
    }
    sceneHandle.stats.failedModels = []
    failedModels.value = []
    refreshTree()
    refreshMonitoring()
    editRevision.value += 1
    return targets.length
  }
  const dataSource = createMockDataSource({
    leakPoints: document.leakPoints ?? [],
    devices: sceneHandle.devices,
    seed: 20260921,
    intervalMs: 2000,
  })
  // 数据源：本期用 mock，接口形状与后续 HTTP/WebSocket 一致，替换时界面代码不动
  // 数据源：当前为"静态"——点位值固定为场景里录入的值，不做模拟推送。
  // 数据源对象与订阅链路保留，将来接真实数据源只需在这里 connect()。
  dataKind.value = 'static'
  dataSource.subscribe((snapshot) => {
    lastUpdate.value = new Date(snapshot.updatedAt).toLocaleTimeString()
    lastSnapshot = snapshot
    for (const point of snapshot.points) {
      const target = (document.leakPoints ?? []).find((item) => item.id === point.pointId)
      if (!target) continue
      target.ppm = point.ppm
      target.level = point.level
    }
    summary.value = summarizeLeakPoints(document.leakPoints ?? [])
    services.leakMarkers?.update(snapshot.points)

    // 趋势曲线跟踪"当前最严重"的点位，告警时曲线最有意义
    const worst = [...snapshot.points].sort((a, b) => b.ppm - a.ppm)[0]
    if (worst) trendBuffer = pushTrend(trendBuffer, worst.pointId, worst.ppm)
    refreshMonitoring()
  })
  refreshMonitoring()
  if (sceneHandle.stats.failedModels?.length) {
    sceneNotice.value = `有 ${sceneHandle.stats.failedModels.length} 个模型加载失败，已用占位体顶替：${sceneHandle.stats.failedModels.slice(0, 3).join('、')}`
  }
  summary.value = sceneHandle.summary
  loadedModules.value = modules
  activeCamera.value = runtime.scene.activeCamera?.metadata?.cameraId ?? ''
  applyDeviceAlpha(deviceAlpha.value)

  /** 批量改装置透明度：同样走材质写回，保证画面与场景数据一致 */
  function applyDeviceAlpha(value) {
    for (const device of sceneHandle.devices) {
      const documentNode = tree.index.get(device.nodeRef)?.source
      if (!documentNode) continue
      applyMaterialChange(documentNode, sceneHandle.nodesById.get(device.nodeRef), { alpha: value, transparent: value < 1 })
    }
    editRevision.value += 1
  }

  return {
    ...runtime,
    ...sceneHandle,
    modules,
    document,
    selection,
    gizmo,
    focusDeviceById,
    ensurePointDevice,
    addDetectionPoint,
    clearPendingPoint,
    nextPointSequence,
    cleanupFailedModels,
    refreshPointSuggestion,
    applyDeviceAlpha,
    resourceLibrary,
    resourceFiles,
    placeResource,
    importFiles,
    placeSample,
    renameSelected,
    deleteSelected,
    scheduleSave,
    refreshCameraPresets,
    storage,
    dispose() {
      unsubscribe()
      stopPick()
      sceneFocus.cancel()
      detailSwap.releaseAll()
      dataSource.disconnect()
      gizmo.dispose()
      highlight.dispose()
      runtime.dispose()
    },
  }
}

const { canvasRef, ready, fps, error, runtimeError, handle, rebuild } = useBabylonScene(createScene)

// 兜底：任何未捕获的异常都显示出来，避免"黑屏但一句话都没有"
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    runtimeError.value = event?.message ?? String(event)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason
    runtimeError.value = reason?.message ? reason.message : String(reason)
  })
}

watch(deviceAlpha, (value) => {
  handle.value?.applyDeviceAlpha?.(value)
})

// 任何编辑（坐标 / 材质 / 重命名 / 增删 / 相机预设）都会自增 editRevision，这里统一触发存档
watch(editRevision, () => {
  handle.value?.scheduleSave?.()
})

// 选中对象变化时，把编号前缀与坐标推荐值同步进表单
watch(pointSuggestion, () => {
  pointEditorRef.value?.applySuggestion?.()
})

watch(gizmoMode, (mode) => {
  handle.value?.gizmo?.setMode(mode)
})

function switchCamera(cameraId) {
  if (handle.value?.focusCameraPreset?.(cameraId)) activeCamera.value = cameraId
}

/** 从装置聚焦回到厂区总览 */
function backToOverview() {
  if (handle.value?.focusCameraPreset?.('camera-overview')) activeCamera.value = 'camera-overview'
}

/** 相机机位编辑：改坐标 / 拖距离与高度滑杆，立即生效并写入场景数据 */
function onCameraUpdate({ field, axis, value }) {
  const current = handle.value
  const document = current?.document
  const camera = (document?.cameras ?? []).find((item) => item.id === cameraEditId.value)
  if (!camera) return

  recordHistory('调整机位')
  if (field === 'distance') {
    scaleCameraDistance(document, camera.id, value)
  } else {
    const index = { x: 0, y: 1, z: 2 }[axis]
    if (index === undefined) return
    const next = [...(camera[field] ?? [0, 0, 0])]
    next[index] = value
    camera[field] = next
  }

  // 拖滑杆时用瞬时应用，避免相机一边飞一边被改
  current.focusCameraPreset?.(camera.id, { durationMs: 0 })
  activeCamera.value = camera.id
  editRevision.value += 1
}

function onCameraCapture() {
  const current = handle.value
  const camera = current?.scene?.activeCamera
  if (!camera || !current?.document) return
  recordHistory('保存当前视角')
  const name = (current.document.cameras ?? []).find((item) => item.id === cameraEditId.value)?.name
  captureCameraPreset(current.document, cameraEditId.value, {
    alpha: camera.alpha,
    beta: camera.beta,
    radius: camera.radius,
    target: [camera.target.x, camera.target.y, camera.target.z],
    name,
  })
  current.refreshCameraPresets?.()
  editRevision.value += 1
  sceneNotice.value = '已用当前视角覆盖该机位'
}

function onCameraApply() {
  if (handle.value?.focusCameraPreset?.(cameraEditId.value)) {
    activeCamera.value = cameraEditId.value
    sceneNotice.value = '已切到该机位'
  }
}

/** 恢复默认：从程序内置场景里取该机位的原始坐标（不受本地存档影响） */
async function onCameraReset() {
  const current = handle.value
  if (!current?.document) return
  try {
    const packaged = await (await fetch(SCENE_URL)).json()
    const original = (packaged.cameras ?? []).find((item) => item.id === cameraEditId.value)
    if (!original) {
      sceneNotice.value = '程序内置场景里没有这个机位'
      return
    }
    updateCameraPreset(current.document, cameraEditId.value, { position: original.position, target: original.target })
    current.focusCameraPreset?.(cameraEditId.value, { durationMs: 0 })
    activeCamera.value = cameraEditId.value
    editRevision.value += 1
    sceneNotice.value = `已把「${original.name}」恢复为程序默认机位`
  } catch (error) {
    sceneNotice.value = `恢复默认失败：${error?.message ?? error}`
  }
}

function selectFromTree(nodeId) {
  handle.value?.selection?.select(nodeId, 'tree')
}

function clearSelection() {
  handle.value?.selection?.clear('ui')
}

/** 属性面板里输入坐标后，同时改引擎对象与场景数据 */
function onTransformUpdate({ field, axis, value }) {
  const current = handle.value
  if (!current || !selectedNode.value) return
  recordHistory('修改坐标')
  const engineNode = current.nodesById.get(selectedNodeId.value)
  applyTransformValue(selectedNode.value, engineNode, field, axis, value)
  editRevision.value += 1
}

/** 属性面板里的颜色 / 透明度 / 透明开关 */
function onMaterialUpdate(patch) {
  const current = handle.value
  if (!current || !selectedNode.value) return
  recordHistory('修改材质')
  const engineNode = current.nodesById.get(selectedNodeId.value)
  applyMaterialChange(selectedNode.value, engineNode, patch)
  editRevision.value += 1
}

function placeSampleModel() {
  handle.value?.placeSample?.()
}

function onImportFiles(files, options) {
  recordHistory('导入模型')
  handle.value?.importFiles?.(files, options)
}

function onPlaceResource(resource) {
  const current = handle.value
  if (!current) return
  recordHistory('放置模型')
  const file = current.resourceFiles?.get(resource.id)
  current.placeResource?.(resource, file ? { file } : { url: resource.uri })
}

function onDropFiles(event) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) onImportFiles(files)
}

function onRenameNode(nextName) {
  recordHistory('重命名')
  handle.value?.renameSelected?.(nextName)
}

function onDeleteNode() {
  recordHistory('删除节点')
  handle.value?.deleteSelected?.()
}

/** 点位列表点击：选中该点位所属装置（相机、淡化、精细档会自动跟随） */
function onSelectPoint(row) {
  selectedPointId.value = row.id
  handle.value?.focusDeviceById?.(row.deviceId)
  // 先选中装置（面板/淡化/精细档跟随），再按点位坐标取景；
  // 后一次动画会打断前一次，因此最终镜头停在点位上
  if (row.position) handle.value?.focusOnPosition?.(row.position, { distance: 7 })
}

/** 告警点击：聚焦到对应装置 */
function onFocusAlarm(deviceId) {
  handle.value?.focusDeviceById?.(deviceId)
}

/** 新增检测点位：校验 → 写场景 → 补 3D 标记 → 刷新台账 */
function onAddPoint(payload) {
  const current = handle.value
  if (!current) return
  pointError.value = ''
  pointNotice.value = ''

  const { ok, errors, draft } = buildPointDraft(payload)
  if (!ok) {
    pointError.value = errors.map((item) => item.message).join('；')
    return
  }

  recordHistory('新增检测点位')
  if (pointTargetNodeId.value) {
    const device = current.ensurePointDevice?.(draft, pointTargetNodeId.value)
    if (!device) {
      pointError.value = '无法关联点位所属装置，请重新点击模型上的位置'
      return
    }
  }
  const result = current.addDetectionPoint(draft)
  if (!result.ok) {
    pointError.value = result.message
    return
  }

  // 保存后锁定位置：移除待放置标记与手柄，后续不再可拖动该点位
  if (placingPoint.value) {
    placingPoint.value = false
    pendingPosition.value = null
    current.clearPendingPoint?.()
  }
  pointNotice.value = `已新增点位：${draft.code}`
  pointSequenceHint.value = current.nextPointSequence?.() ?? ''
}

function onRefreshSuggestion() {
  pointEditorRef.value?.applySuggestion?.()
}

/** 3D 拾取或 gizmo 拖动后，把坐标写回新增点位表单 */
function onScenePointPicked(position) {
  const rounded = roundPosition(position)
  if (!rounded) return
  pendingPosition.value = rounded
  pointEditorRef.value?.setPosition?.(rounded)
}

function onStartPickPoint() {
  placingPoint.value = true
  pointError.value = ''
  pointNotice.value = '请在模型上点击要新增点位的位置；蓝球出现后可拖动手柄微调'
}

function onCancelPickPoint() {
  placingPoint.value = false
  pendingPosition.value = null
  handle.value?.clearPendingPoint?.()
  pointNotice.value = '已取消位置拾取'
}

/** 清理素材缺失导致的失效节点（不再在地面上留占位立方体） */
function onCleanupFailedModels() {
  recordHistory('清理失效节点')
  const removed = handle.value?.cleanupFailedModels?.() ?? 0
  pointNotice.value = removed ? `已清理 ${removed} 个失效节点` : '没有需要清理的节点'
}

/** 记录编辑历史：在每个编辑动作**之前**调用 */
function recordHistory(label) {
  const documentSnapshot = handle.value?.document ? JSON.stringify(handle.value.document) : ''
  if (history.record(label, documentSnapshot)) syncHistoryState()
}

function syncHistoryState() {
  canUndo.value = history.canUndo()
  canRedo.value = history.canRedo()
}

/** 恢复快照：写入本地存档后重载场景（当前实现是"整场景重载"，约 1–2 秒） */
async function restoreSnapshot(snapshot) {
  const current = handle.value
  if (!current?.storage) return
  try {
    await current.storage.saveScene(JSON.parse(snapshot))
    historyNotice.value = '正在恢复…'
    window.location.reload()
  } catch (error) {
    historyNotice.value = `恢复失败：${error?.message ?? error}`
  }
}

async function undoEdit() {
  const current = handle.value
  if (!current?.document) return
  const entry = history.undo(JSON.stringify(current.document))
  syncHistoryState()
  if (!entry) {
    historyNotice.value = '没有可撤销的操作'
    return
  }
  historyNotice.value = `已撤销：${entry.label}`
  await restoreSnapshot(entry.snapshot)
}

async function redoEdit() {
  const current = handle.value
  if (!current?.document) return
  const entry = history.redo(JSON.stringify(current.document))
  syncHistoryState()
  if (!entry) {
    historyNotice.value = '没有可重做的操作'
    return
  }
  historyNotice.value = `已重做：${entry.label}`
  await restoreSnapshot(entry.snapshot)
}

// 快捷键：Ctrl+Z 撤销 / Ctrl+Y（或 Ctrl+Shift+Z）重做
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault()
      undoEdit()
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault()
      redoEdit()
    }
  })
}

function onExportScene() {
  const current = handle.value
  if (!current) return
  const name = sceneFileName(current.document?.meta?.name ?? 'factory-scene')
  sceneNotice.value = downloadScene(current.document, name) ? `已导出：${name}` : '当前环境不支持下载'
}

async function onImportScene(files) {
  const file = files?.[0]
  if (!file) return
  const result = parseScene(await file.text())
  if (!result.ok) {
    const first = result.errors[0]
    sceneNotice.value = `导入失败：${first?.path ? `${first.path} ` : ''}${first?.message ?? '未知错误'}`
    return
  }
  const storage = await getStorage()
  await storage.saveScene(result.document)
  sceneNotice.value = '导入成功，正在重新加载场景…'
  setTimeout(() => window.location.reload(), 300)
}

async function onResetScene() {
  const storage = await getStorage()
  await storage.clearAll()
  sceneNotice.value = '已清除本地存档，正在恢复初始场景…'
  setTimeout(() => window.location.reload(), 300)
}

function onSaveCameraPreset() {
  const current = handle.value
  const camera = current?.scene?.activeCamera
  if (!camera) return
  const preset = captureCameraPreset(current.document, 'camera-user', {
    alpha: camera.alpha,
    beta: camera.beta,
    radius: camera.radius,
    target: [camera.target.x, camera.target.y, camera.target.z],
    name: '自定义视角',
  })
  current.refreshCameraPresets?.()
  editRevision.value += 1
  sceneNotice.value = `已保存视角预设：${preset.name}`
}
</script>

<template>
  <div class="stage" @dragover.prevent @drop.prevent="onDropFiles">
    <canvas ref="canvasRef" class="stage__canvas" />

    <header class="hud hud--top">
      <AppMenu
        :open="activeDropdown === 'menu'"
        @toggle="toggleDropdown('menu')"
        @command="onMenuCommand"
      />
      <button
        type="button"
        class="hud__mini"
        :class="{ 'is-active': activeDropdown === 'tree' }"
        title="展开/收起场景层级"
        @click="toggleDropdown('tree')"
      >
        场景层级 {{ activeDropdown === 'tree' ? '▾' : '▸' }}
      </button>
      <div v-if="activeDropdown === 'tree'" class="tree-pop">
        <SceneTree :items="treeItems" :selected-id="selectedNodeId" @select="selectFromTree" />
        <div class="hud__row">
          <button type="button" @click="clearSelection">取消选择</button>
        </div>
      </div>
      <span class="hud__title">{{ sceneName || '加载场景中' }}</span>
      <span class="hud__tag" :class="ready ? 'is-ok' : 'is-wait'">{{ ready ? '已就绪' : '加载中' }}</span>
      <span class="hud__metric">{{ fps }} FPS</span>
      <span class="hud__metric">已选：{{ selectedNodeId || '无' }}</span>
      <span class="hud__metric">加载 {{ loadMs }} ms</span>
      <span v-if="loadProgress" class="hud__metric">{{ loadProgress }}</span>
      <span class="hud__metric">{{ stage }}</span>
      <span v-if="diagnostics" class="hud__metric">
        网格 {{ diagnostics.meshes }} · 材质 {{ diagnostics.materials }} · 贴图 {{ diagnostics.textures }} · 相机 {{ diagnostics.activeCamera ?? '无' }} · 帧 {{ diagnostics.frameCount }}
      </span>
      <span v-if="dataKind" class="hud__metric">数据源 {{ dataKind }}{{ lastUpdate ? ' · ' + lastUpdate : '' }}</span>
    </header>

    <aside class="hud hud--left">
      <p class="hud__label">场景统计</p>
      <ul class="hud__list">
        <li>节点 {{ stats.nodeCount }}　装置 {{ stats.deviceCount }}</li>
        <li>泄漏点位 {{ summary.total }}　超标 {{ summary.exceed }}　预警 {{ summary.warn }}</li>
      </ul>

      <p class="hud__label">相机预设</p>
      <div class="hud__row hud__row--wrap">
        <button
          v-for="preset in cameraPresets"
          :key="preset.id"
          type="button"
          :class="{ 'is-active': activeCamera === preset.id }"
          @click="switchCamera(preset.id)"
        >
          {{ preset.name }}
        </button>
        <button type="button" title="回到厂区总览" @click="backToOverview">返回总览</button>
      </div>

      <p class="hud__label">业务模块</p>
      <ul class="hud__list">
        <li v-for="moduleId in loadedModules" :key="moduleId">{{ moduleId }}</li>
      </ul>

      <p v-show="panelVisible.camera" class="hud__label">相机机位调节</p>
      <div class="hud__row">
        <button type="button" :disabled="!canUndo" title="Ctrl+Z" @click="undoEdit">撤销</button>
        <button type="button" :disabled="!canRedo" title="Ctrl+Y" @click="redoEdit">重做</button>
      </div>
      <p v-if="historyNotice" class="hud__hint">{{ historyNotice }}</p>
      <p v-show="panelVisible.pointEditor" class="hud__label">新增检测点位</p>
      <PointEditorPanel
        v-show="panelVisible.pointEditor"
        ref="pointEditorRef"
        :devices="deviceOptions"
        :suggestion="pointSuggestion"
        :sequence-hint="pointSequenceHint"
        :placing="placingPoint"
        :notice="pointNotice"
        :error="pointError"
        @submit="onAddPoint"
        @pick-position="onStartPickPoint"
        @cancel-pick="onCancelPickPoint"
      />
      <div v-if="failedModels.length" class="hud__row">
        <button type="button" @click="onCleanupFailedModels">清理 {{ failedModels.length }} 个失效节点</button>
      </div>
      <CameraPanel
        v-show="panelVisible.camera"
        :presets="cameraPresets"
        :editing-id="cameraEditId"
        :position="editingCamera?.position ?? [0, 0, 0]"
        :target="editingCamera?.target ?? [0, 0, 0]"
        @edit="cameraEditId = $event"
        @update="onCameraUpdate"
        @capture="onCameraCapture"
        @apply="onCameraApply"
        @reset="onCameraReset"
      />
    </aside>

    <aside class="hud hud--right">
      <p class="hud__label">属性</p>
      <MonitoringPanel
        v-if="monitoring"
        :view="monitoring"
        :selected-point-id="selectedPointId"
        @select-point="onSelectPoint"
        @focus-device="onFocusAlarm"
        @update-ppm="onUpdatePpm"
        @maintenance="onOpenMaintenance"
      />

      <PropertyPanel
        :node="selectedNode"
        :device="selectedDevice"
        :points="selectedPoints"
        :revision="editRevision"
        @update="onTransformUpdate"
        @material="onMaterialUpdate"
        @rename="onRenameNode"
        @delete="onDeleteNode"
      />

      <p class="hud__label">变换工具{{ gizmoSupported ? '' : '（当前环境不支持）' }}</p>
      <div class="hud__row">
        <button type="button" :class="{ 'is-active': gizmoMode === 'translate' }" @click="gizmoMode = 'translate'">位移</button>
        <button type="button" :class="{ 'is-active': gizmoMode === 'rotate' }" @click="gizmoMode = 'rotate'">旋转</button>
        <button type="button" :class="{ 'is-active': gizmoMode === 'scale' }" @click="gizmoMode = 'scale'">缩放</button>
        <button type="button" :class="{ 'is-active': gizmoMode === 'none' }" @click="gizmoMode = 'none'">隐藏</button>
      </div>

      <p v-show="panelVisible.resource" class="hud__label">资源库</p>
      <ResourcePanel
        v-show="panelVisible.resource"
        :resources="resources"
        :busy="importBusy"
        :notice="importNotice"
        @place-sample="placeSampleModel"
        @import-files="onImportFiles"
        @place="onPlaceResource"
      />

      <p v-show="panelVisible.sceneFile" class="hud__label">场景文件</p>
      <SceneFilePanel
        v-show="panelVisible.sceneFile"
        :storage-kind="storageKind"
        :saved-at="savedAt"
        :notice="sceneNotice"
        @export-scene="onExportScene"
        @import-scene="onImportScene"
        @save-camera="onSaveCameraPreset"
        @reset="onResetScene"
      />

      <p class="hud__label">装置透明度</p>
      <input v-model.number="deviceAlpha" type="range" min="0.05" max="1" step="0.05" />
      <p class="hud__value">{{ deviceAlpha.toFixed(2) }}</p>
      <button type="button" @click="rebuild">重建场景</button>
      <p class="hud__hint">点左侧树节点或 3D 物体即可选中；点空白处取消选择。</p>
    </aside>

    <p v-if="error" class="hud hud--error">加载失败：{{ error }}</p>

    <p v-if="runtimeError" class="hud hud--error">运行异常：{{ runtimeError }}</p>

    <div v-if="upgradeNotice" class="hud hud--upgrade">
      <span>{{ upgradeNotice }}</span>
      <button type="button" @click="onResetScene">加载新版场景</button>
    </div>

    <MaintenanceDialog
      :open="maintenanceOpen"
      :point="maintenancePoint"
      :error="maintenanceError"
      :last-operator="lastMaintenanceOperator"
      @save="onSaveMaintenance"
      @close="onCloseMaintenance"
      @pick-photo="onPickPhoto"
    />
  </div>
</template>

<style>
:root {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background: #05080f;
  color: #dbe6f5;
  font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}

.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.stage__canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  touch-action: none;
}

.hud {
  position: absolute;
  border: 1px solid rgba(120, 180, 255, 0.25);
  border-radius: 10px;
  background: rgba(8, 18, 32, 0.62);
  backdrop-filter: blur(6px);
  padding: 12px 16px;
}

.hud--top {
  top: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.hud--left {
  top: 84px;
  left: 16px;
  width: 262px;
  z-index: 10;
  max-height: calc(100vh - 120px);
  overflow: auto;
  display: grid;
  gap: 8px;
}

.hud--right {
  top: 84px;
  right: 16px;
  width: 276px;
  z-index: 10;
  max-height: calc(100vh - 120px);
  overflow: auto;
  display: grid;
  gap: 10px;
}

.hud__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hud__title {
  font-size: 15px;
  font-weight: 600;
}

.hud__tag {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}

.hud__tag.is-ok {
  background: rgba(56, 196, 130, 0.18);
  color: #68e0a8;
}

.hud__tag.is-wait {
  background: rgba(230, 180, 70, 0.18);
  color: #f0c674;
}

.hud__metric {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: #8fb6e6;
}

.hud__label {
  margin: 0;
  font-size: 13px;
  color: #a9c2e0;
}

.hud__list {
  margin: 0;
  padding-left: 16px;
  font-size: 12.5px;
  line-height: 1.8;
  color: #c8d8ec;
}

.hud__row {
  display: flex;
  gap: 8px;
}

.hud__row--wrap {
  flex-wrap: wrap;
}

/* 场景层级下拉：挂在顶部栏下方，与菜单互斥展开，因此不会互相遮挡 */
.tree-pop {
  position: absolute;
  top: 34px;
  /* 与菜单同样策略：在左侧面板右侧展开（左侧面板占 x=16..278），二者互不遮挡 */
  left: 274px;
  z-index: 38;
  width: 268px;
  padding: 8px;
  border: 1px solid rgba(120, 180, 255, 0.3);
  border-radius: 10px;
  background: rgba(8, 18, 32, 0.96);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.hud__mini.is-active {
  border-color: rgba(127, 212, 255, 0.85);
  background: rgba(52, 118, 190, 0.7);
}

.hud__value {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-size: 20px;
  font-weight: 600;
}

.hud__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #7f9ab8;
}

.hud button {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid rgba(120, 180, 255, 0.35);
  border-radius: 8px;
  background: rgba(30, 70, 120, 0.5);
  color: #dbe6f5;
  font-size: 13px;
  cursor: pointer;
}

.hud button:hover {
  background: rgba(40, 92, 152, 0.6);
}

.hud button.is-active {
  border-color: rgba(120, 200, 255, 0.85);
  background: rgba(52, 118, 190, 0.75);
}

.hud__mini {
  flex: none;
  padding: 3px 8px;
  font-size: 11.5px;
}

.hud--error {
  left: 16px;
  bottom: 16px;
  max-width: 65%;
  border-color: rgba(255, 120, 120, 0.45);
  color: #ffb4b4;
  font-size: 13px;
}

.hud--upgrade {
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  border-color: rgba(230, 180, 70, 0.55);
  color: #f0d09a;
  font-size: 13px;
}

.hud--upgrade button {
  flex: none;
  white-space: nowrap;
  border-color: rgba(240, 200, 120, 0.6);
  background: rgba(140, 100, 30, 0.5);
}
</style>

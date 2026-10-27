# 智慧工厂数字孪生平台

基于 **Vue 3 + Babylon.js + Electron** 的 3D 产品展示、数字孪生和泄漏检测可视化平台。项目支持厂区总览、装置聚焦、模型导入、相机预设、检测点位、超标判定、维修记录和本地离线运行。

> 本项目中的企业名称、检测值和维修人等业务数据均为虚构演示数据，不对应任何真实企业或人员。

## 主要功能

- 3D 厂区与装置模型展示，支持自由旋转、缩放和相机预设。
- 从厂区总览平滑聚焦到指定装置，并支持按需加载精细模型。
- 在模型表面点击新增检测点位，使用平移手柄微调，保存后锁定位置。
- 检测点位自动编号，支持法兰、压盖、阀门、管道、焊缝、泵、压缩机等部位类型。
- 按介质执行检测值分级，支持正常、超标和严重超标状态。
- 3D 点位标记与监控台账双向联动。
- 维修期限、维修时间、维修后数值、维修人、备注和维修照片记录。
- GLB/GLTF 模型导入、自动尺寸归一、材质、透明度和层级编辑。
- 场景 JSON 导入导出、撤销/重做、自动存档和相机视角保存。
- Electron 免安装绿色版，全程离线运行。

## 下载体验版

前往仓库的 **Releases** 页面下载：

```text
FactoryTwin-portable-v0.1.0-win-x64.zip
```

下载后：

1. 右键 ZIP 并选择“全部解压缩”。
2. 进入解压后的 `win-unpacked` 文件夹。
3. 双击 `FactoryTwin.exe`。

程序不需要安装 Node.js，也不依赖外部网站。Windows 首次启动时可能显示“未知发布者”，这是因为当前版本没有购买代码签名证书。

> 不要只把 `FactoryTwin.exe` 单独复制出来。它需要同目录下的 `resources` 等文件才能运行。

应用数据保存在：

```text
%APPDATA%\factory-twin
```

## 源码运行

环境要求：Windows 10/11 x64、Node.js、pnpm。本项目已使用 Node.js 24 和 pnpm 11 验证。

```bash
pnpm install
pnpm dev
```

浏览器开发地址通常为 `http://localhost:5173`。

常用命令：

```bash
pnpm smoke       # 无头自动测试
pnpm build       # 构建 Web 产物到 dist/
pnpm app:dev     # 启动 Electron 开发版
pnpm app:pack    # 生成免安装绿色版到 release/win-unpacked/
```

生成内置装置模型：

```bash
node scripts/make-flange-glb.mjs
node scripts/make-refinery-glbs.mjs
node scripts/make-flange-pair-glb.mjs
```

## 技术结构

```text
factory-twin/
├─ electron/                    Electron 主进程与 app:// 协议
├─ public/
│  ├─ models/                   应用内模型
│  ├─ scenes/                   演示场景 JSON
│  └─ vendor/babylon/           离线 Draco 解码器
├─ scripts/                     模型生成、测试与打包脚本
├─ src/
│  ├─ app/                      智慧工厂业务模块
│  └─ platform/                 可复用的场景编辑器与 3D 平台层
├─ docs/                        架构、场景格式和功能说明
├─ build/                       Electron 应用图标
└─ package.json
```

核心文档：

- [场景数据模型](docs/05-场景数据模型.md)
- [交互与选择机制](docs/06-交互与选择机制.md)
- [资产与资源清单](docs/07-资产与资源清单.md)
- [泄漏检测方向](docs/09-泄漏检测方向.md)
- [模型缩放与性能优化](docs/11-模型缩放与性能优化.md)

## 数据与离线说明

- 场景和维修照片使用 Electron 固定来源 `app://factory-twin/` 下的 IndexedDB 保存。
- 应用运行时不需要网络。
- `release/`、`release-next/`、`node_modules/`、`dist/` 和本机存档不会提交到 Git。
- 绿色版程序压缩包通过 GitHub Releases 发布，不直接提交到源码历史。

## 素材与许可

项目代码目前未附加额外开源许可证。第三方依赖、生成模型和公开模型的授权说明见 [ASSET_LICENSES.md](ASSET_LICENSES.md)。

公开仓库中的模型仅用于展示项目能力。如计划将本项目用于商业交付，请在实际交付前重新核对模型来源、生成工具条款和素材再分发权限。

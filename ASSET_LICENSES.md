# 素材、依赖与许可说明

本项目包含自行编写的程序、程序化生成的模型、第三方软件依赖以及用户提供的公开演示模型。各部分授权状态如下。

## 1. 项目代码

当前源码仓库未附加额外的开源许可证。公开仓库允许通过 GitHub 页面查看，但未经版权所有者许可，不应将代码另行复制、闭源发布或作为商业产品再分发。

如果希望允许他人自由使用、修改和再发布，可在 GitHub 仓库中补充 `MIT` 或 `Apache-2.0` 许可证；补充前应确认所有贡献者和素材的授权情况。

## 2. 程序化生成的模型

以下模型由本仓库脚本生成，不是第三方下载素材：

| 文件 | 生成脚本 | 说明 |
| --- | --- | --- |
| `public/models/refinery/flange-gland.glb` | `scripts/make-flange-glb.mjs` | 带压盖和法兰的轻量装置模型 |
| `public/models/refinery/flange-gland-hi.glb` | `scripts/make-flange-glb.mjs` | 高精度版本 |
| `public/models/refinery/horizontal-tank.glb` | `scripts/make-refinery-glbs.mjs` | 卧式储罐轻量模型 |
| `public/models/refinery/horizontal-tank-hi.glb` | `scripts/make-refinery-glbs.mjs` | 卧式储罐高精度版本 |
| `public/models/refinery/pump-unit.glb` | `scripts/make-refinery-glbs.mjs` | 离心泵机组轻量模型 |
| `public/models/refinery/pump-unit-hi.glb` | `scripts/make-refinery-glbs.mjs` | 离心泵机组高精度版本 |
| `public/models/flange-pair-gland.glb` | `scripts/make-flange-pair-glb.mjs` | 导入测试用双法兰模型 |

这些模型由几何参数生成，不包含第三方贴图。项目所有者可在确认自身权利后，为其单独指定 CC0、CC BY 或其他素材许可。

## 3. 用户提供的公开演示模型

文件：

```text
public/models/factory-showcase.glb
```

来源与处理：

- 由用户提供，原始文件名包含 `20260917115326_爱给网_aigei_com.glb`。
- 用户说明该模型属于公开 AI 模型，项目内不包含真实厂区机密。
- 项目使用 `scripts/optimize-model.mjs` 对几何进行了简化。
- 原始 40 MB 大模型没有放入本仓库或安装包。

发布者在上传前应确认所用生成工具、下载平台或原始作者的条款允许模型再分发。如无法确认，应从公开仓库和 Release 包中移除 `factory-showcase.glb`，不影响其余程序运行。

## 4. Babylon.js Draco 解码器

目录：

```text
public/vendor/babylon/Draco/
```

Draco 使用 **Apache License 2.0**。完整许可证随目录保留在：

```text
public/vendor/babylon/Draco/draco.license
```

## 5. 主要 npm 依赖

| 依赖 | 主要许可 |
| --- | --- |
| Vue | MIT |
| Babylon.js | Apache-2.0 |
| Vite | MIT |
| Electron | MIT |
| electron-builder | MIT |
| glTF Transform | MIT |
| meshoptimizer | MIT |

依赖的完整版本记录在 `pnpm-lock.yaml`。从 npm 安装的依赖不会进入本源码仓库。

## 6. 演示数据与维修记录

仓库中的检测值、维修人、维修时间、维修照片引用及其他业务数据均为演示数据，不包含真实企业机密或真实人员信息。

公开截图、导出台账或演示视频前，仍建议检查画面中是否出现了本机路径、姓名、联系方式、内网地址或其他个人信息。

## 7. 发布者检查清单

- [ ] 已确认 `factory-showcase.glb` 允许公开再分发。
- [ ] 已决定代码采用“保留所有权利”还是 MIT/Apache-2.0。
- [ ] 已确认 Release ZIP 不包含本机用户数据和真实维修照片。
- [ ] 已在 README 中说明绿色版为未签名程序。
- [ ] 如未来加入新的第三方模型，已在本文件登记来源和许可。

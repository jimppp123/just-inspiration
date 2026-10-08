# AI 灵感 / ICE WORKS

> 用流动的图像浏览参考灵感，收藏自己的 Pinterest 画板入口。

[![License: MIT](https://img.shields.io/badge/代码许可-MIT-black.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![Responsive](https://img.shields.io/badge/体验-Responsive-black)

ICE WORKS 将后数字极简主义、编辑式排版和有机交互组合为三段式体验：水平液态画廊负责展示，瀑布流负责浏览大量收藏，单图聚焦页负责继续裂变探索。

当前主画面已接入 `HYPERD4ZE / DESIGN` 公开画板，并将最新 25 条收藏处理为本地 WebP；页面随后按 Pinterest 游标继续同步公开返回的后续收藏。

## Pinterest 画板

点击右上角当前画板名称可打开画板列表。粘贴 `https://www.pinterest.com/用户名/画板名/` 形式的公开画板链接后即可切换灵感墙；独立外链箭头用于打开 Pinterest 原页。链接保存在当前浏览器，移除操作只删除本地链接。

“DESIGN”是不可移除的主画板，使用本地图片作为网络失败时的保底；其他公开画板通过同源图片代理载入。单个画板最多同步 200 条公开 Pin，按 Pin ID 和源图片去重，并复用当前页面会话的请求。当前不支持私密画板。

## 风格

**后数字极简主义（Post-digital Minimalism）× 实验性编辑设计。**

- 新瑞士主义排版：无衬线字体、非对称信息布局和克制的信息层级。
- 联系表式图像密度：不同纵横比连续拼接，适合大量视觉收藏。
- 有机数字动效：液态连接、拉丝、分裂和重新聚合。
- 独立艺术指导气质：适合作品集、时装、字体、音乐与文化项目。

整体气质可以概括为：**克制、冰冷、先锋、实验，同时带有液态生命感。**

## 核心体验

### 水平液态画廊

首页以 22 张图片水平循环展示，中央为大卡片，两侧逐渐缩小并随玻璃边缘向外弯曲。自动轮播支持鼠标拖拽、触屏滑动、滚轮和方向键切换；操作结束后恢复自动播放。`JUST INSPIRATION.` 位于下方，左上角黑点打开完整瀑布流总览。点击图片进入裂变探索页，文字使用全站统一的原位液化融合。

首页优先读取未裁切的原比例图片，卡片随图片尺寸适配；远程图片失败时使用本地素材。两侧玻璃轮廓带柔和色散。图片上的光标是一枚透明折射镜片，按钮与输入框使用更小的精确圆环；触屏保留原生操作。

### 高密度灵感墙

收藏以响应式瀑布流连续展示，不再受圆盘可见数量限制。图片保持原始纵横比例和统一圆角，不显示单图名称或编号；鼠标悬停时，图片与附近卡片由同一张 SDF 表面绘制，产生轻微拖拽、玻璃折射和边缘粘连。

GIF 收藏在瀑布流中直接播放原始动图；静态图片继续使用 WebGL 液态悬停。

进入时图片从左上角黑点弹出，返回时收回同一位置；顶部控件始终固定。右上角画板名支持原位液化动画并打开玻璃菜单，页面不显示收藏数量。返回首页会保留此前的轮播位置。

### 液态裂变

点击瀑布流图片后，其余图片退出，选中图悬浮到屏幕中央。再次点击母图会展开 8 张关联图；继续长按时关联图逐张弹出，最多保留 30 张，松手后停止增长。

加载时主图下方显示流动三点；图片准备好后三点合并并飞向主图中心，约 0.5 秒抵达，随后出现连续向外扩散的细窄折射涟漪，周期为 0.9 秒。中心白点透明度为 28%，首次分裂后白点与涟漪一起渐隐。操作提示仅供屏幕阅读器读取；加载失败时显示重试图标，减少动态效果模式使用静态白点。

关联结果直接读取该 Pin 的 Pinterest 推荐流，不再使用同画板图片或颜色相似度猜测。所有图片在同一张 WebGL SDF 表面中融合，出生时短暂拉丝，分离后保持玻璃折射、轻微悬浮和指针拖拽感。

子图按稳定的随机位置形成疏密变化，尺寸略有差异；静态排列避开重叠，移动时通过阻尼弹簧和轻微体积压缩相互避让。

### 连续探索

点击裂变出的图片会将它置为新的中心并请求下一组 Pinterest 关联结果；双击任意裂变图片会在新标签打开对应 Pin。右下角“加入画板”将当前中心图片保存到此浏览器的本地画板收藏。整个过程限制为 30 个关联节点，不会无限扩张。

## 交互方式

| 操作             | 结果                                      |
| ---------------- | ----------------------------------------- |
| 圆盘滚动 / 拖拽  | 临时接管自动轮播并切换展示灵感            |
| 点击圆盘图片     | 进入该图片的裂变探索页                    |
| 点击左上角黑点   | 打开完整瀑布流灵感墙或返回首页            |
| 点击瀑布流图片   | 其余图片退场，选中图悬浮到中央            |
| 再次点击中央图片 | 一次展开 8 张 Pinterest 关联图片          |
| 长按中央图片     | 逐张增加关联图片，最多 30 张              |
| 松开             | 停止增加，保留当前裂变结果                |
| 点击裂变出的图片 | 将该图设为中心并继续探索                  |
| 双击裂变图片     | 在 Pinterest 打开该图片                   |
| 加入画板         | 将当前中心图片保存到本地画板收藏          |
| Esc / 返回控件   | 关闭裂变层或画板菜单                      |
| 右上角画板名称   | 打开列表并切换、添加或移除 Pinterest 画板 |

## 技术实现

- **Next.js 16 / React 19**：页面结构与组件生命周期。
- **CSS Multi-column**：不同纵横比图片的高密度瀑布流。
- **Three.js / GLSL SDF**：圆盘、裂变、液态融合、拉丝与玻璃边缘。
- **Web Animations / SVG Filter**：文字双层原位模糊、合并阈值与 1.2 秒 circ-out 重组；标题、按钮和状态共用同一实现。
- **渲染调度**：弹窗底层与后台标签页暂停 WebGL，画板静止时保留上一帧；缓存布局测量，绘制索引不变时跳过上传。
- **Pointer Events**：统一鼠标、触控笔和触屏长按手势。
- **会话缓存**：减少重复读取 Pinterest 公开画板。
- **Tailwind CSS v4**：基础页面样式。

## 本地运行

环境要求：**Node.js 20 或更高版本**。

```bash
git clone https://github.com/MegD1/Ice-works-showcase.git
cd Ice-works-showcase
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

| 命令            | 用途             |
| --------------- | ---------------- |
| `npm run dev`   | 启动开发服务器   |
| `npm run build` | 创建生产构建     |
| `npm start`     | 运行生产构建     |
| `npm run lint`  | 执行 ESLint 检查 |

## 部署

项目包含画板读取、图片代理和相关推荐接口，需要支持 Next.js 服务端路由的环境。可将 GitHub 仓库导入 Vercel，或在 Node.js 服务器上执行 `npm ci && npm run build` 后运行 `npm start`。GitHub Pages 无法运行这些服务端接口。

## 画板数据

主画板导入清单位于 `public/pinterest/ai-inspiration.json`：

```json
{
  "id": "437271445093996998",
  "file": "pinterest/ai-inspiration/01.webp",
  "url": "https://www.pinterest.com/pin/437271445093996998/",
  "name": "DESIGN 01"
}
```

处理后的图片位于 `public/pinterest/ai-inspiration/`。原图地址、Pin 地址、原始尺寸和导入日期均保留在清单中。

数组顺序同时决定：

1. 初始灵感墙的排列顺序；
2. 本地缓存图片与 Pinterest Pin 的对应关系；
3. 首页轮播的展示顺序。

## 项目结构

```text
app/
  page.js                 页面入口
  globals.css             全局样式与字体
  api/pinterest/          公开画板数据与同源图片代理

components/
  Notebook.jsx            首页与灵感册的页面状态
  Carousel.jsx            首页 WebGL 水平液态画廊
  InspirationControls.jsx 总览入口、来源与画板控件
  InspirationShelf.jsx    瀑布流与画板管理
  InterfaceEffects.jsx    页面玻璃边框与共用滤镜
  ActionCursor.jsx        透明玻璃光标与控件精确圆环
  BoardMenu.jsx           共用玻璃画板菜单
  MotionText.jsx          按钮液滴融化动画
  focus/
    FocusExplorer.jsx     单图聚焦、相关推荐与手势
    LiquidScene.jsx       裂变 WebGL 布局与动画
    ShelfLiquid.jsx       可见瀑布流图片、悬停与边缘折射
    shelfTransition.js    图片从导航黑点弹出与收回
    shelfShaders.js       圆盘式融合、波纹与玻璃边缘
    layout.js             不规则排列与碰撞避让
    lookup.js             屏幕分块候选图片索引
    params.js             裂变参数
    shaders.js            裂变 SDF 与玻璃着色
  pinterest/
    boards.js             画板链接校验与浏览器本地存储
    server-fetch.js       Pinterest 限定域名服务端读取
  ring/
    ascii.js              ASCII 字形纹理
    atlas.js              图像图集
    gui.js                开发调试面板
    meta.js               旧版圆盘文字形变（当前首页未使用）
    params.js             全部可调参数
    projects.js           作品数据
    splitText.js          开场标题拆字
  shaders/
    planeShaders.js       圆环、粒子、液态与玻璃效果
    textShaders.js        标题字形揭示
```

## 开发调试

圆盘与裂变场景在开发环境中分别提供 lil-gui 参数面板，生产构建不会加载。Next.js 开发指示器已通过项目配置关闭。

## 衍生关系与署名

本仓库是基于 Yousuf Soomro 的 [Viscose Carousel](https://github.com/Yousuf-developer/Viscose-carousel) 制作的**衍生研究版本**。原项目采用 MIT License，原始版权声明已保留在 [LICENSE](LICENSE) 中。

原圆盘概念与 WebGL 基础实现来自该项目，并继续作为当前首页展示。本版本在其基础上增加：

- 接入可分页同步的 Pinterest 公开画板；
- 新增高容量响应式瀑布流；
- 新增基于真实 Pinterest 推荐流的连续分支探索；
- 新增长按递增、最多 30 张的 WebGL 液态裂变；
- 保留本地图片作为离线与限流降级。

请勿将本项目表述为完全独立于原项目的原创实现。

## 素材与字体说明

### 图像

当前图片来自用户提供的公开画板 [DESIGN](https://www.pinterest.com/HYPERD4ZE/design/)，仅用于个人灵感册展示。每张本地素材对应的 Pin 地址和原始图片地址记录在 `public/pinterest/ai-inspiration.json`。

这些图片**不属于本项目作者，也不受本仓库 MIT License 授权**。公开展示或商业使用前，请替换为拥有明确授权的原创素材。

### 字体

| 字体                          | 用途                     | 许可说明                                       |
| ----------------------------- | ------------------------ | ---------------------------------------------- |
| PingFang SC Heavy（苹方特粗） | 开发面板字体备选         | Apple 保留版权，用户提供，仅供当前项目本地使用 |
| Noto Sans SC（思源黑体）      | 全站界面文字             | SIL Open Font License，本地 WOFF2 子集         |
| Satoshi                       | 开发面板中的拉丁字体备选 | Fontshare 免费字体                             |
| Geist                         | 数字、年份与加载计数     | SIL Open Font License                          |

当前界面统一使用思源黑体子集，许可见 [OFL.txt](public/fonts/OFL.txt)。开发面板保留苹方作为本地备选，其文件 `public/fonts/PingFang-SC-Heavy.ttf` 已被 Git 忽略，不随仓库发布；该字体版权归 Apple 所有，不受本仓库 MIT License 授权。

旧版本使用的 PP Neue Montreal 是商业字体，仅供本地评估，不受本仓库 MIT License 授权。中文版已移除该字体文件；如自行恢复使用，仍需向字体厂商购买相应授权。

## 当前限制

- 画板链接与收藏保存在当前浏览器，尚未实现私密画板授权和跨设备同步；公开数据最多读取 8 页、200 条 Pin，数量和可用性受 Pinterest 公开接口限制。
- 液态玻璃依赖 WebGL 与浏览器的合成能力，低性能设备会降低像素比或回退到原生 DOM 图片。
- GLSL 在浏览器运行时编译，因此修改 shader 后除构建检查外，还需要实际打开页面验证。

## License

源代码遵循 [MIT License](LICENSE)。字体文件和 `public/` 内的第三方图像不包含在该许可范围内。

## 致谢

- [Yousuf Soomro](https://github.com/Yousuf-developer) — Viscose Carousel 原始概念与实现。
- [Ashima Arts](https://github.com/ashima/webgl-noise) — GLSL Simplex Noise。
- [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) — 中文字体，通过 Google Fonts 获取当前界面的 WOFF2 子集。
- [GSAP](https://gsap.com/) 与 [Three.js](https://threejs.org/)。

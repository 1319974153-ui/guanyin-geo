---
name: "观引 GEO · 黑曜折光"
description: "以黑曜石表面、冷白文字与局部青蓝折光承接真实业务操作。"
colors:
  bg: "#080c11"
  sidebar: "#0b1017"
  surface: "#101720"
  surface-raised: "#17212d"
  ink: "#eef4fc"
  muted: "#9cabbe"
  line: "#273443"
  control-line: "#60778d"
  accent: "#a6e8ed"
  accent-hover: "#d0f7f8"
  primary-ink: "#09202a"
  pale: "#193139"
  selected-line: "#456c78"
  hover: "#233541"
  green: "#9bd9c2"
  green-bg: "#122d27"
  amber: "#e8c995"
  amber-bg: "#302719"
  red: "#ffb0ad"
  danger-bg: "#381f24"
  light-edge: "#4a7c8f"
  light-wash: "#123341"
  hero-ground: "#0d1620"
  hero-beam: "rgba(72,178,202,.10)"
  focus-edge: "#b5f2f4"
  light-bg: "#f7fafb"
  light-sidebar: "#eef3f6"
  light-surface: "#ffffff"
  light-surface-raised: "#eaf1f5"
  light-ink: "#172c3b"
  light-muted: "#506778"
  light-line: "#d3dfe6"
  light-control-line: "#7c8f9c"
  light-accent: "#175e70"
  light-accent-hover: "#114959"
  light-primary-ink: "#ffffff"
  light-pale: "#e0f0f2"
  light-selected-line: "#a4c9cf"
  light-hover: "#dce9ed"
  light-green: "#236747"
  light-green-bg: "#eaf5ee"
  light-amber: "#805316"
  light-amber-bg: "#fff4df"
  light-red: "#ac3535"
  light-danger-bg: "#fff0ee"
  light-light-edge: "#a1c6d1"
  light-light-wash: "#e1f3f5"
  light-hero-ground: "#eef7f9"
  light-hero-beam: "rgba(61,157,177,.10)"
  light-focus-edge: "#175e70"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "38px"
    fontWeight: 550
    lineHeight: 1.35
    letterSpacing: "-.025em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "16px"
    fontWeight: 550
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "12px"
  button:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "13px"
    fontWeight: 500
  button-primary:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "13px"
    fontWeight: 650
rounded:
  tag: "5px"
  field: "7px"
  control: "8px"
  panel: "12px"
  explorer: "14px"
  hero: "16px"
spacing:
  compact: "8px"
  control-inline: "16px"
  mobile: "18px"
  panel: "24px"
  desktop: "32px"
  hero: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.button-primary}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.primary-ink}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
  nav-active:
    backgroundColor: "{colors.pale}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
  platform-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.field}"
    padding: "9px 12px"
  platform-tag:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "4px 9px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "22px"
  hero:
    backgroundColor: "{colors.hero-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.hero}"
    padding: "36px"
---

# Design System: 观引 GEO

## Overview

**Creative North Star: "黑曜折光"**

黑曜石底色、冷白文字与局部青蓝折射形成安静而精致的操作环境。光感集中在主行动区域；内容、表单和真实证据依靠稳定的语义色与清晰字阶承载。

默认深色，保留浅色外观。界面采用离线可用的系统中文字体与原生 HTML/CSS/JavaScript；Canvas 光带为本项目原生实现。Paper Shaders 与 Motion Primitives 仅为设计参考，未集成其源码或运行时。

**Key Characteristics:**
- 深色为默认，浅色共享同一组语义角色。
- 局部折光与指针响应常开，无光效开关或光效偏好。
- 系统字体、细边框、分层表面与克制的圆角。
- 状态与操作保留可读文字，视觉光感不代表业务成功。

本文件是用户已批准新视觉方向后的实现扫描；更新旧浅色后台记录。代码依据为 `public/luminous.css`（在 `precision.css` 后加载）、`luminous.js`、`appearance.js` 与 `simple.js`。今天页的具体构图见 `.impeccable/surfaces/today.md`，不将其强制推广到其他页面。

## Colors

深色 token 使用无前缀名称，浅色对应 `light-` 前缀；运行时都映射到同名 CSS 自定义属性，值以上方 frontmatter 为准。

### Primary

- 冰青动作色 `accent` / `accent-hover`：主按钮、链接、导航与平台选中态；`primary-ink` 保证按钮文字清晰。
- 青蓝选中面 `pale`、选中边 `selected-line` 与焦点边 `focus-edge`：表达当前操作对象。

### Secondary

- 状态绿 `green` / `green-bg`、提醒琥珀 `amber` / `amber-bg`、错误浅红 `red` / `danger-bg`：只配合真实状态文字使用。

### Neutral

- 黑曜背景 `bg`、侧栏 `sidebar`、内容面 `surface` 与抬升面 `surface-raised` 形成明度层次。
- 冷白正文 `ink`、雾蓝说明 `muted`、结构线 `line` 与控件线 `control-line` 区分阅读和操作层级。
- `hero-ground`、`hero-beam`、`light-edge` 约束局部光感，不作为数据编码。

**The Evidence Before Light Rule.** 光只承担材质与焦点表达，不能替代真实采样、发布回执或成功状态。

## Typography

使用 frontmatter 中的本地系统字体栈，中文优先使用 PingFang SC / Microsoft YaHei。保留该离线产品约束，不下载展示字体。正文继承 14px / 1.6；内容说明通常为 13px / 1.8–1.85，辅助文字 11–12px。

主行动标题使用 display 角色，桌面 38px，1100px 以下 34px，700px 以下 32px。页面标题 25px，手机 24px；分区标题 16px，平台详情标题 18px。数量采用 tabular-nums。字重与字距以前述 token 及组件样式为准，不通过纯大写英文标签制造层级。

## Layout

简单模式保留“今天 / 待我确认 / 效果”，高级工具在原折叠入口。桌面侧栏 212px，顶栏 68px，主内容最大 1440px，左右留白 32px。常规内容间距 24px。

今天页使用全宽主行动区域与平台选择区，下方工作进度、待确认以 1.6:1 分列，右列最小 260px。1100px 以下下方改为单列，主区域留白 24px；700px 以下使用原抽屉导航（宽 240px），顶栏 60px，内容左右 18px，区域间距 18px。平台按钮换行，详情与操作纵向排列。

## Elevation & Depth

内容依靠表面明度、细边框与局部折光产生深度，常规卡片不使用厚重投影。抽屉沿用 `0 24px 80px #0008` 的覆盖层投影，遮罩为 `rgba(2,6,12,.8)`。

Canvas 光带常开，无光效开关或独立偏好。单个 requestAnimationFrame 循环在绘制间隔超过 40ms 时更新；页面隐藏或主区域离屏时暂停循环。系统 `prefers-reduced-motion: reduce` 下保留静态画面，并关闭指针驱动的位移。Canvas 像素比上限 1.5；手机将画面透明度降至 .26，桌面为 .88。指针高光的透明度过渡为 200ms，普通控件颜色过渡为 160ms ease。

**The Local Light Rule.** 折光限定在主行动区域，正文、表单和证据保持稳定；系统减少动态效果时使用静态画面。

## Shapes

圆角按用途分层：小标签 5px、输入与平台标签 7px、按钮及导航 8px、内容面 12px、平台区域 14px、主行动区域 16px。边线通常为 1px。装饰层不接收指针事件，避免挡住真实操作。

## Components

### Buttons

主按钮为冰青面和深色文字，常规按钮为抬升面，轻按钮为透明面；默认内边距 10px 16px、最小高度 38px。主行动区域按钮最小高度 42px。悬停、按下与禁用沿用真实组件状态；禁用透明度 .45。键盘焦点为 2px 的 focus-edge 轮廓、向外偏移 4px。

### Inputs / Fields

输入框使用侧栏底色、控件边线与 7px 圆角；悬停边线变为动作色，占位文字使用 muted。保留原标签、错误文字与表单语义。

### Navigation

桌面导航最小高度 44px，选中项使用 pale 背景、accent 文字、selected-line 边框。当前页面仍通过 aria-current 表达；手机沿用抽屉导航。

### Chips / Platform Tabs

静态平台标签使用抬升面、5px 圆角。交互平台标签使用 7px 圆角与明确选中边框，手机最小高度 44px；支持方向键、Home、End。切换同步详情与检测入口，选择本身不触发付费模型调用。

### Cards / Containers

内容卡片为 surface 底色、line 边框与 12px 圆角，常规内边距 22px，进度/结果/待确认区域为 24px。主行动区域使用独立的 hero-ground、light-edge 和局部 Canvas，具体构图留在页面契约中。

### Appearance

外观按钮仅切换深浅主题。浏览器 origin 内的 `guanyin.appearance.nocturne` 保存外观，默认深色；不进入业务数据与备份。存储不可用时仍可切换当前页。打印沿用浅色规则并隐藏 Canvas。

## Do's and Don'ts

### Do:
- Do 使用共享语义色同步覆盖深色、浅色、表单、抽屉与三个简单模式入口。
- Do 保留清晰焦点、真实状态文字和键盘可操作的平台标签。
- Do 保留离线系统字体与本地静态资源。
- Do 以系统减少动态效果和离屏暂停适配动态光感。

### Don't:
- Don't 添加光效开关、光效偏好或与视觉修改绑定的自动发布权限。
- Don't 将装饰光、选中态或零样本解释为采样成功、AI 收录或增长结果。
- Don't 声称集成仅用于视觉参考的第三方库。

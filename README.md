# 小红书网页 Ultra HDR 原图

针对笔记 `6ad20e490000000015013635` 的实测和油猴脚本，测试日期 2026-10-30。

安装：在 Tampermonkey 中新建脚本，用 `xhs-ultrahdr.user.js` 的全部内容替换模板，保存后刷新小红书笔记页。右下角按钮可关闭并恢复网页图片；原图加载后可点「打开原图」。脚本未自动安装到用户浏览器。

默认只处理详情页/详情弹窗里可见、宽至少 280 px 的 `note_pre_post_uhdr/…` 图片，不处理信息流缩略图、普通图片或实况视频。并发最多两张，加载失败保留网页图片。页面无需登录信息以外的额外凭据，脚本不读取 Cookie，不调用第三方服务，无 GM 跨域请求权限。使用普通 `<img>` 直接加载 CDN 原文件，不需要 Canvas 的跨域读取权限。

## 发现

移动端分享页 `/discovery/item/<笔记 ID>` 携带原链接的 `xsec_token` 返回了图片 `fileId`。桌面 `/explore/…` 的匿名请求在本次环境返回通用页面。移动网页下发的 `!h5_1080jpg` 文件本身也是 SDR，切换手机 User-Agent 并不能直接获得 HDR。

可用规则：

```text
https://ci.xiaohongshu.com/<完整 fileId>
```

必须保留 `note_pre_post_uhdr/` 目录。对于此帖，把 fileId 截成最后一段会返回 404。不要对带签名的网页图片 URL 仅删 `!` 后缀；直接使用独立原文件域名和完整对象路径。本次也验证了 `sns-img-qc.xhscdn.com` 和 `sns-img-bd.xhscdn.com` 返回相同字节，但脚本仅用前述域名。

第一张图片：

| 版本 | 字节数 | 增益图标记 | MPF |
| --- | ---: | --- | --- |
| H5 JPEG | 243737 | 无 | 无 |
| 原文件 | 7616401 | Adobe HDR gain map + ISO 21496-1 | 有 |

整帖 10 张：第 1、2、4–10 张共 9 张的原文件含 Adobe 增益图标记和 MPF；第 2 张未发现 ISO 增益图标记，其余 8 张存在。第 3 张是实况图，不在此脚本处理范围。详见 `research/note-images.json`；检测基于文件结构/标记，未用光度仪验证实际显示亮度。

Edge 已成功打开第一张原文件，浏览器识别为 5886 × 4244。可直接打开 `compare.html` 对比本地保存的原始字节。该页面切换同一张图片的 SDR / HDR 版本，不做转码。

## 范围与限制

- 原文件保留增益图，浏览器、系统及屏幕仍需支持相应 HDR 显示。状态「已替换」仅说明原文件加载成功，不证明实际 HDR 输出。
- 该路径规则在这篇笔记验证成功，不保证适用于小红书所有历史图片或未来 CDN 规则。若页面未在图片地址中暴露该目录，脚本不会猜测或调用 App 私有接口。
- 油猴脚本已做语法、地址转换和模拟 DOM 行为测试；尚未在真实 Tampermonkey 里安装做整页端到端测试。站点 DOM/CSP/其他扩展仍可能影响替换。
- 原图每张数 MB，会增加流量及浏览器解码内存。

运行测试：`node --test tests/userscript.test.mjs`。

格式说明：[Android Ultra HDR 格式](https://developer.android.com/media/platform/hdr-image-format)、[Adobe Gain Map](https://helpx.adobe.com/camera-raw/desktop/hdr-and-advanced-output/gain-map.html)。

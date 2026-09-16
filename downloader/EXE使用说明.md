# Windows EXE 便携版

将 `Xianyu-Materials-1.0.0-Windows-x64.exe` 复制到其他 Windows 10/11 64 位电脑，双击启动。无需安装 Node.js、Python 或 Chrome。首次启动需要解包，可能稍慢；采集与下载需要联网。

1. 点击“登录闲鱼”，在软件自带浏览器中自行登录。
2. 粘贴闲鱼网页版商品长链接并加入任务。
3. 完成后打开素材目录或下载 ZIP。登录、验证或商品失效会显示失败原因，可处理后重试。

素材保存在当前用户“文档/闲鱼商品素材”；登录资料和任务记录保存在 `%APPDATA%/xianyu-material-downloader/collector`（以软件实际用户目录为准）。复制 EXE 不会携带账号和历史素材。关闭主窗口会关闭采集浏览器。

这是未购买代码签名证书的独立软件，Windows 可能显示未知发布者。请仅运行本人交付的文件，可用同目录 SHA256 校验文件核对。

目前支持商品长链接，短口令不支持。商品文案是否已全部展开会单独标记；软件不将不确定的完整性标为成功。另一台物理电脑仍需实机验收。

开发构建：在 downloader 运行 npm ci；设置 PLAYWRIGHT_BROWSERS_PATH 为该目录下 build-browser，运行 npx playwright install chromium --no-shell，再运行 npm run pack。构建仅包含白名单源码、运行依赖和浏览器，不包含 .local、历史商品或登录资料。

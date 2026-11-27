# Antigravity Gemini 用量

为 Antigravity 桌面版添加两个用量入口。

- 左上角的「用量」显示今天、近 7 天和近 30 天的本机 Gemini 历史用量。
- 输入框底栏的圆形按钮显示本次对话的模型和思考档位用量。数据包括 Token 消耗、占比、缓存命中率，以及历史记录中提供的思考 Token。面板顶部还显示上下文窗口的估算已用 Token、上限、剩余量和占用百分比。

两个入口使用悬浮层。统计在本机从 Antigravity 历史服务读取。缓存命中率等于缓存读取 Token 除以全部输入 Token。历史记录没有标明档位时显示「未记录」。

上下文圆环显示当前可供模型读取的上下文占用。达到 70% 时提示「占用偏高」，达到 90% 时提示「接近上限」。占用可能在上下文压缩后下降。实时状态不可用时，面板会标注所用的最近记录。Antigravity 未返回窗口上限时，只显示已用量。

有原生分类数据时，可展开「构成」查看对话消息、系统提示词、工具、规则和技能等分类。分类占比按对应记录的总量计算。分类来自较早的模型请求时，面板会单独标注来源。

## Windows 安装与还原

### 双击安装

1. 在 [Releases](https://github.com/xuyuanbao666/antigravity-gemini-usage/releases) 下载文件名以 `windows-x64.zip` 结尾的安装包。
2. 完整解压到长期保留的目录。保存正在处理的 Antigravity 工作后，双击 `Install.cmd`。
3. 需要卸载时，在同一目录双击 `Restore.cmd`。还原前请保留解压目录，里面存着安装时的原版程序包备份。

安装包自带便携式 Node.js，无需单独安装。已验证的客户端版本是 Windows x64 上的 Antigravity 2.35.2。

### 从源码安装

从源码安装需有 Node.js 22 或更新版本及 PowerShell。先保存正在处理的工作，再在能写入 Antigravity 安装目录的 PowerShell 中运行：

```powershell
.\manage.ps1 -Action Install
```

安装器会在仓库目录备份当前的 `app.asar`，再添加用量入口。现有汉化也包含在该备份里。非默认安装位置可通过 `-AntigravityPath` 指定程序路径，Node.js 可通过 `-NodePath` 指定。

```powershell
.\manage.ps1 -Action Restore
```

还原前会核对 Antigravity 版本和程序包哈希。客户端更新可能覆盖插件。更新后可以重新运行安装命令，若新版程序包的结构有变化，安装器会报错。

历史服务发现方式参考了 [Obsidian Prism 的渲染进程适配器](https://github.com/RMvdesi/obsidian-prism/blob/v1.0.7/vendor/pulse-dashboard/sidecars/panel/renderer-rpc-adapter.mjs)。

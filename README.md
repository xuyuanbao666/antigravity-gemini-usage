# Antigravity Gemini 用量

为 Antigravity 桌面版添加两个用量入口。

- 左上角的「用量」显示今天、近 7 天和近 30 天的本机 Gemini 历史用量。
- 输入框底栏的圆形按钮显示本次对话的模型和思考档位用量。数据包括 Token 消耗、占比、缓存命中率，以及历史记录中提供的思考 Token。

两个入口使用悬浮层。统计在本机从 Antigravity 历史服务读取。缓存命中率等于缓存读取 Token 除以全部输入 Token。历史记录没有标明档位时显示「未记录」。

## Windows 安装与还原

已在 Windows 版 Antigravity 2.35.2 实测。需要 Node.js 22 或更新版本及 PowerShell。先保存正在处理的工作，再在能写入 Antigravity 安装目录的 PowerShell 中运行：

```powershell
.\manage.ps1 -Action Install
```

安装器会在仓库目录备份当前的 `app.asar`，再添加用量入口。现有汉化也包含在该备份里。非默认安装位置可通过 `-AntigravityPath` 指定程序路径，Node.js 可通过 `-NodePath` 指定。

```powershell
.\manage.ps1 -Action Restore
```

还原前会核对 Antigravity 版本和程序包哈希。客户端更新可能覆盖插件。更新后可以重新运行安装命令，若新版程序包的结构有变化，安装器会报错。

历史服务发现方式参考了 [Obsidian Prism 的渲染进程适配器](https://github.com/RMvdesi/obsidian-prism/blob/v1.0.7/vendor/pulse-dashboard/sidecars/panel/renderer-rpc-adapter.mjs)。

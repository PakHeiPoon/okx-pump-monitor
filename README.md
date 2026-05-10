# OKX 涨幅榜推送 - GitHub Actions版

零服务器、零代理、免费。

## 部署步骤（5分钟）

### 1. 创建飞书机器人

- 飞书 → 任意一个群（自己建一个"币圈预警"群）
- 点击群名 → 设置 → 群机器人 → 添加机器人 → **自定义机器人**
- 名字随便起，点确定
- **复制Webhook地址**，类似 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx-xxxx-xxxx`
- 安全设置：可以暂时不勾，先跑通再说

### 2. 创建GitHub仓库

- 登录 https://github.com
- 右上角 + → New repository
- 名字随便（比如 `okx-pump-monitor`），**选 Private**（保护Webhook）
- 不勾任何初始化选项，Create

### 3. 上传代码

最简单的方法：网页直接传

- 进入新仓库页面 → "uploading an existing file"
- 把这个文件夹里所有内容拖进去：
  - `scan.py`
  - `state.json`
  - `.github/workflows/scan.yml`（注意路径！要保持目录结构）
- Commit changes

如果你会用git：
```bash
git init
git remote add origin https://github.com/你的用户名/okx-pump-monitor.git
git add .
git commit -m "init"
git push -u origin main
```

### 4. 配置Secret（飞书Webhook）

- 仓库页面 → Settings → 左侧 Secrets and variables → Actions
- 点 New repository secret
- Name: `FEISHU_WEBHOOK`
- Secret: 粘贴第1步的飞书Webhook地址
- Add secret

### 5. 启用Actions

- 仓库页面 → Actions 标签
- 如果提示要启用，点 "I understand my workflows, go ahead and enable them"
- 左侧应该能看到 "OKX Pump Scanner" workflow
- 点进去 → 右侧 "Run workflow" → Run workflow（手动触发一次测试）
- 等30秒-1分钟，看运行结果

如果绿色✓且飞书群没收到消息，说明本轮没有满足阈值的币（正常情况）。
如果红色✗，点进去看日志报错。

### 6. 自动定时跑

workflow里设置了 `*/5 * * * *`，**仓库有任何push操作后**Actions会按这个时间表自动跑。

注意：GitHub对没活动的仓库会暂停定时任务（约60天）。如果你长期没动，会收到邮件提醒。

## 调参

直接改 `.github/workflows/scan.yml` 里的环境变量：

```yaml
TOP_N: '100'           # 监控涨幅榜前N
THRESHOLD: '2.0'       # 1分钟涨幅阈值（百分比）
MIN_VOL_USDT: '5000'   # 单根K线最小成交额
LOOKBACK_BARS: '5'     # 检查最近几根K线
```

或者在 `scan.py` 里改默认值。

提交后下一轮自动生效。

## 怎么知道在跑

- 仓库 Actions 页面会列出每次运行
- 绿色✓ = 跑成功
- 飞书消息会附带运行时间，方便核对

## 限制

- **5分钟一次**：免费版GitHub Actions最快只能5分钟跑一次。意味着你收到推送时，那根1m K线可能已经收盘1-5分钟。对2%涨幅这种事件够用，不算太晚
- **每月2000分钟免费**：每次跑约30秒-1分钟，5分钟跑一次 = 每月约8000-16000分钟。超限会停。Public仓库无限免费但不安全（Webhook泄露），所以建议**用Private + 把扫描时间从5分钟拉长到10分钟**省额度，或者升级Pro
- 想真正实时，回去看腾讯云Clash那个方案

## 升级路径

如果跑了几天觉得5分钟太慢、想要WebSocket级实时：
- 把这个仓库的scan.py逻辑挪到腾讯云上跑（有Clash代理）
- 改成长连接WebSocket版（之前给过的monitor.py）
- 飞书Webhook配置不变

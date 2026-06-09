# 飞书 callback HK 自托管部署手册

**目标**：把飞书事件回调从 Vercel Edge 搬到香港 Lighthouse（IP `124.156.170.240`），把跨境 RTT 从 300ms+ 砍到 ~30ms，**根治飞书 SAVE URL 3s timeout** 问题。

---

## 一次性准备：域名/sslip 选一个

飞书 callback URL 必须 **HTTPS**。两种方案：

### A. 你有自己的域名（推荐）

把 `feishu.example.com` 加一条 A 记录指向 `124.156.170.240`。

### B. 没域名 — 用 sslip.io（零成本）

直接用 `124-156-170-240.sslip.io`，免备案、免 DNS 配置，Let's Encrypt 也认。

> **下文用 `feishu.example.com` 作占位**，你换成自己的域名或 sslip 即可。

---

## Step 1：服务器初始化（CentOS）

腾讯轻量云 → 登录该实例 → 终端里执行：

```bash
# 防火墙开 80/443（HTTP-01 challenge + HTTPS 服务）
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

# 同时去腾讯云控制台 → 防火墙 → 添加 TCP 80 + 443 规则

# 创建服务用户（不给 shell，最小权限）
sudo useradd -r -s /usr/sbin/nologin feishu

# Python 3.11+
sudo dnf install -y python3.11 python3.11-pip git
```

## Step 2：拉代码 + 装依赖

```bash
sudo mkdir -p /opt/feishu-callback
sudo chown -R feishu:feishu /opt/feishu-callback
cd /opt/feishu-callback

# 用 git 拉，便于后续 git pull 升级
sudo -u feishu git clone https://github.com/PakHeiPoon/okx-pump-monitor.git repo
sudo -u feishu cp -r repo/hk-callback/* .
sudo rm -rf repo

# 装 venv
sudo -u feishu python3.11 -m venv venv
sudo -u feishu ./venv/bin/pip install -r requirements.txt
```

## Step 3：填环境变量

```bash
sudo cp .env.example .env
sudo nano .env   # 填入 LARK_APP_ID / LARK_APP_SECRET / LARK_VERIFY_TOKEN / Supabase 凭证
sudo chmod 600 .env
sudo chown feishu:feishu .env
```

## Step 4：装 systemd 服务

```bash
sudo cp feishu-callback.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now feishu-callback

# 验证
sudo systemctl status feishu-callback
# 本地健康检查
curl http://127.0.0.1:8000/healthz
# 应返回 {"service":"feishu-callback","method":"POST only",...}

# 查 log
sudo journalctl -u feishu-callback -f
```

## Step 5：装 Caddy（自动 TLS）

```bash
# CentOS 装 Caddy
sudo dnf install -y 'dnf-command(copr)'
sudo dnf copr enable -y @caddy/caddy
sudo dnf install -y caddy

# 装配置
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/{DOMAIN}/feishu.example.com/g' /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy

# 启动
sudo systemctl enable --now caddy
sudo systemctl status caddy

# 验证 TLS 签发成功（首次几秒后看 log）
sudo journalctl -u caddy -n 50
```

## Step 6：外部健康检查

在你本地（mac）：

```bash
# challenge fast path 模拟（应该 < 200ms 返回）
curl -i -X POST https://feishu.example.com/feishu/callback \
  -H "Content-Type: application/json" \
  -d '{"type":"url_verification","challenge":"hk_test","token":"你的_VERIFY_TOKEN"}'

# 期待：HTTP/2 200 / body {"challenge":"hk_test"}
# 期待 RTT：50-150ms（中国大陆 → HK）
```

## Step 7：飞书后台切换 URL

1. 开放平台 → 你的应用 → **事件与回调** → **回调配置**
2. **Request URL**：`https://feishu.example.com/feishu/callback`
3. 点 **保存** —— 这次应该秒过 ✅
4. 切到 **事件订阅** → 添加事件 `im.message.receive_v1`（接收消息）
5. 顶部 **应用发布** → 创建新版本 → 提交审核（自审通过即可）
6. 把 bot 拉进你的群

## Step 8：实测 @bot

群里 `@OKX机器人 help` —— 应该立刻收到帮助文本。
然后 `@OKX机器人 mute 30m` → 写入 mute_state，scanner 接下来 30min 不再推飞书但 cron + 回测继续跑。

---

## 升级 / 重启

```bash
cd /opt/feishu-callback
sudo -u feishu git -C /tmp/okx-repo pull   # 或重新 git clone
sudo -u feishu cp /tmp/okx-repo/hk-callback/app.py .
sudo systemctl restart feishu-callback
```

## 监控建议

- **uptime**：systemd 自动 restart=always 已经处理崩溃
- **延迟**：偶尔跑一下 Step 6 的 curl，观察响应时间
- **journald 留存**：默认 4 周，足够查问题
- **告警**：可以加个 GitHub Actions 跑 https check（已有 watchdog workflow 类似模式）

## 排错

| 症状 | 检查 |
|---|---|
| `curl /healthz` 不通 | `systemctl status feishu-callback` + `journalctl -u feishu-callback -n 50` |
| 飞书 SAVE URL 仍超时 | 防火墙 80/443 是否真的开了？腾讯云控制台 + iptables 都要 |
| TLS 证书签发失败 | `journalctl -u caddy -n 100`，确认 DNS A 记录已生效（`dig feishu.example.com`） |
| @bot 不回 | 检查 1) 事件订阅已添加；2) `journalctl -u feishu-callback -f` 看是否收到请求；3) `LARK_VERIFY_TOKEN` 是否填对 |
| Supabase 写失败 | 看 journal log 有无 4xx；确认 `SUPABASE_SERVICE_KEY` 是 service_role 不是 anon |

## 资源占用预估

- Python 进程常驻 ~80 MB
- Caddy ~30 MB
- 总占用 < 200 MB，**剩 1.8 GB 给 Hermes Agent 和其它服务**

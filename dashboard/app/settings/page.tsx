import { MutePanel } from "@/components/mute-panel";

export const metadata = {
  title: "Settings · OKX Pump Monitor",
};

export const dynamic = "force-dynamic";

export default function SettingsPage(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          飞书推送控制 · cron 与回测在静音期间继续运行
        </p>
      </div>

      <MutePanel />

      <div className="text-muted-foreground mt-8 text-xs space-y-1">
        <p>
          V2.24: mute 控制从飞书 @bot 改到这里。原因：企业 admin 没启用自建应用，
          飞书的 im.message.receive_v1 事件不能推到 callback。
        </p>
        <p>
          后端：POST /api/mute 写 supabase.mute_state（id=1 单行表）。
          scanner 每轮扫描前 fetch_mute_state 决定是否推飞书。
        </p>
      </div>
    </main>
  );
}

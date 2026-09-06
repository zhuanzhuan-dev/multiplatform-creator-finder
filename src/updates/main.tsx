import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const manifest = chrome.runtime.getManifest();
const visibleVersion = manifest.version_name || manifest.version;
const previousVersion = new URLSearchParams(location.search).get("from");
const iconUrl = chrome.runtime.getURL("icons/icon-128.png");

function UpdatePage() {
  return (
    <main>
      <header>
        <img className="product-icon" src={iconUrl} alt="多平台自动找号助手图标" />
        <div>
          <p className="eyebrow">版本更新</p>
          <h1>V{visibleVersion} 已就绪</h1>
        </div>
      </header>
      <p className="lead">改善切换标签页或使用其他软件时的任务运行，让后台等待按实际经过时间推进，并在运行中断后尝试恢复。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>后台计时</strong><span>由扩展后台安排等待，按截止时间推进任务，并维持采集页面的活动状态。</span></li>
          <li><strong>中断恢复</strong><span>页面刷新或运行停滞后尝试恢复，保留任务截止时间；暂停和停止会取消旧任务操作。</span></li>
          <li><strong>进度可见</strong><span>侧栏显示当前处理步骤和真实前后台状态，持续异常时暂停并说明原因。</span></li>
        </ul>
      </section>
      <aside>更新后请刷新已打开的抖音页面。运行期间保持电脑唤醒、Chrome 运行及网络可用。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>);

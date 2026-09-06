import { StrictMode } from "react";
import { themeReady } from "../shared/theme";
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
      <p className="lead">首页聚焦运行和判断结果，外观设置与辅助状态按需展开。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>右上角设置</strong><span>点击齿轮调整外观主题，支持点击外部或按 Esc 收起，主题偏好持续保存。</span></li>
          <li><strong>运行详情收纳</strong><span>待上传队列、下次定时和定时结果移入“查看详情”，长结果完整换行显示。</span></li>
          <li><strong>异常保持可见</strong><span>运行记录中存在异常时，概要区域保留提示，便于及时处理。</span></li>
        </ul>
      </section>
      <aside>重新加载扩展并打开侧栏即可看到新布局。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));

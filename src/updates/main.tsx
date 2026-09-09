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
          <h1>已更新至 V{visibleVersion}</h1>
        </div>
      </header>
      <p className="lead">研究台入口已迁移至公司内网，配对授权页同步使用新的研究台地址。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>打开内网研究台</strong><span>“打开工作台”和“连接研究台”统一前往 fai.zhuanspirit.com/creators。</span></li>
          <li><strong>继续待授权配对</strong><span>升级后重新打开尚在有效期内的配对时，使用新的内网授权页，并保留原配对码和授权进度。</span></li>
          <li><strong>更新安装指引</strong><span>连接公司内网或 VPN，完成公司 SSO 和研究台登录，再确认插件授权。</span></li>
        </ul>
      </section>
      <aside>请保持公司内网或 VPN 连接，并允许插件访问新的研究台域名。侧栏显示“研究台已连接”后，点击“检测连接”确认授权有效。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));

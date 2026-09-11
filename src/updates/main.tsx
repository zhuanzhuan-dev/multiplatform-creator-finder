import { StrictMode } from "react";
import { themeReady } from "../shared/theme";
import { createRoot } from "react-dom/client";
import "./styles.css";
import releases from "./releases.json";

const manifest = chrome.runtime.getManifest();
const visibleVersion = manifest.version_name || manifest.version;
const previousVersion = new URLSearchParams(location.search).get("from");
const iconUrl = chrome.runtime.getURL("icons/icon-128.png");

type Release = (typeof releases)[number];
function ReleaseDetails({ release }: { release: Release }) {
  return <>
    <p className="lead">{release.summary}</p>
    <ul>{release.items.map(item => <li key={item.title}><strong>{item.title}</strong><span>{item.description}</span></li>)}</ul>
    {release.notice ? <aside>{release.notice}</aside> : null}
  </>;
}

function UpdatePage() {
  const current = releases.find(release => release.version === visibleVersion);
  const history = releases.filter(release => release.version !== visibleVersion);
  return (
    <main>
      <header>
        <img className="product-icon" src={iconUrl} alt="多平台自动找号助手图标" />
        <div>
          <p className="eyebrow">版本更新</p>
          <h1>已更新至 V{visibleVersion}</h1>
        </div>
      </header>
      {current ? <section className="current-release"><h2>本次更新</h2><ReleaseDetails release={current} /></section>
        : <p className="lead">当前版本的更新说明尚未收录。</p>}
      <section className="release-history" aria-label="历史版本">
        <h2>历史版本（{history.length}）</h2>
        {history.map(release => <details key={release.version}>
          <summary>V{release.version}<span>记录日期：{release.recordedAt}</span></summary>
          <ReleaseDetails release={release} />
        </details>)}
      </section>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));

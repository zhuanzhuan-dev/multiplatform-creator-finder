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
          <p className="eyebrow">本地测试版本</p>
          <h1>V{visibleVersion} 待测试</h1>
        </div>
      </header>
      <p className="lead">停止后保留结果，最近记录跨轮次延续；设置中查看连接账号，并采样推荐流原始数据。</p>
      <section>
        <h2>待验证内容</h2>
        <ul>
          <li><strong>结果保留</strong><span>停止后保留本轮统计和时长；开始新一轮后，近 24 小时的记录继续保留，侧栏展示最近 5 条，完整页面分页查看。</span></li>
          <li><strong>平台来源</strong><span>每条记录展示抖音、快手、飞瓜或星图等实际来源，支持来源、轮次、结果和关键词筛选。</span></li>
          <li><strong>连接账号</strong><span>设置中展示后台返回的姓名和邮箱。后台接口尚未部署时显示已连接账号 ID。</span></li>
          <li><strong>本地原始采样</strong><span>开发调试中开启采样，保存当前卡片 DOM、解析结果及能读取到的原始字段；支持人工标记类型、导出和清空。</span></li>
        </ul>
      </section>
      <aside>此版本仅供本地测试，尚未发布。原始采样默认关闭，保存在本机，最多 200 条 / 25 MB。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));

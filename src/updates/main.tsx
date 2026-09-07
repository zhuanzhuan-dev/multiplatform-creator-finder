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
      <p className="lead">任务设置合并为双标签面板；正向内容可按严格配额点赞、收藏和关注，默认全部关闭。</p>
      <section>
        <h2>本次更新</h2>
        <ul>
          <li><strong>统一设置面板</strong><span>运行设置与视频、账号规则共用一张卡片，支持标签切换和键盘操作。</span></li>
          <li><strong>更紧凑的表单</strong><span>最短、中心和最长停留时间同排显示，随面板宽度适配；“允许延迟启动”说明定时触发晚到时的处理方式。</span></li>
          <li><strong>正向互动</strong><span>点赞、收藏、关注分别勾选，也可一键全选。只有明确符合条件的正向内容才互动。</span></li>
          <li><strong>严格配额</strong><span>统一百分比分别约束每项操作；10% 表示每处理 10 条普通视频增加 1 次配额。暂停、继续和浏览器重启保留本轮配额。</span></li>
          <li><strong>快捷键互动</strong><span>通过 Z / C / G 发送点赞、收藏、关注，不检查平台状态；已有操作可能被取消。本轮去重，发送不确定时保留配额且不重试。</span></li>
        </ul>
      </section>
      <section>
        <h2>同时包含的运行改进</h2>
        <ul>
          <li><strong>最近 24 小时记录</strong><span>本地保存处理记录，首页预览最近 5 条，完整页面支持按平台来源查看；停止本轮后保留结果。</span></li>
          <li><strong>继续本轮</strong><span>自动恢复抖音推荐任务页，保留原有轮次、统计与进度。</span></li>
          <li><strong>本地调试样本</strong><span>可按需开启原始信息采样并导出，默认关闭，样本保存在本机。</span></li>
        </ul>
      </section>
      <aside>正向互动默认关闭，设置在新一轮生效。快捷键会切换已有状态；实际效果取决于抖音网页及当前键位设置。</aside>
      <footer>
        {previousVersion ? <span>从 V{previousVersion} 更新</span> : <span>当前版本 V{visibleVersion}</span>}
        <button onClick={() => window.close()}>知道了</button>
      </footer>
    </main>
  );
}

void themeReady.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><UpdatePage /></StrictMode>));

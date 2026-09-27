import DOMPurify from "dompurify";
import { marked } from "marked";
import { offlineBook } from "./offline-book";

export function handleBookImageError(event: { target: EventTarget | null }) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  image.hidden = true;
  if (image.nextElementSibling?.classList.contains("image-retry")) return;
  const retry = document.createElement("button");
  retry.type = "button"; retry.className = "image-retry";
  retry.textContent = "配图加载失败，点击重试";
  retry.onclick = () => {
    let source = image.getAttribute("src");
    try { if (image.dataset.bookImageSource) source = offlineBook.imageUrl(image.dataset.bookImageSource); }
    catch { retry.textContent = "安装包缺少这张配图，请重新安装应用"; return; }
    if (!source) return;
    image.onload = () => { image.hidden = false; retry.remove(); image.onload = null; };
    image.removeAttribute("src");
    image.setAttribute("src", source);
  };
  image.after(retry);
}

export function bookMarkdown(value: string) {
  const html = DOMPurify.sanitize(marked.parse(value, { breaks: true }) as string);
  const template = document.createElement("template");
  template.innerHTML = html;
  // Only the image transport changes. Original Markdown and all reference links stay intact.
  for (const image of template.content.querySelectorAll<HTMLImageElement>("img[src]")) {
    const source = image.getAttribute("src")!;
    image.dataset.bookImageSource = source;
    try { image.setAttribute("src", offlineBook.imageUrl(source)); }
    catch { image.setAttribute("src", "data:image/png;base64,"); }
  }
  return template.innerHTML;
}

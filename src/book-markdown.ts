import DOMPurify from "dompurify";
import { marked } from "marked";
import { offlineBook } from "./offline-book";

export function bookMarkdown(value: string) {
  const html = DOMPurify.sanitize(marked.parse(value, { breaks: true }) as string);
  const template = document.createElement("template");
  template.innerHTML = html;
  // Only the image transport changes. Original Markdown and all reference links stay intact.
  for (const image of template.content.querySelectorAll<HTMLImageElement>("img[src]")) {
    image.setAttribute("src", offlineBook.imageUrl(image.getAttribute("src")!));
  }
  return template.innerHTML;
}

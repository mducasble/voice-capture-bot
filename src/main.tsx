import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

// Patch: prevent crashes from browser extensions (e.g. Google Translate)
// that manipulate the DOM outside React's control.
if (typeof Node !== "undefined") {
  const origRemoveChild = Node.prototype.removeChild;
  // @ts-ignore
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      console.warn("[DOM patch] removeChild: node is not a child, skipping.");
      return child;
    }
    // @ts-ignore
    return origRemoveChild.call(this, child);
  };

  const origInsertBefore = Node.prototype.insertBefore;
  // @ts-ignore
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, refNode: Node | null): T {
    if (refNode && refNode.parentNode !== this) {
      console.warn("[DOM patch] insertBefore: ref node is not a child, skipping.");
      return newNode;
    }
    // @ts-ignore
    return origInsertBefore.call(this, newNode, refNode);
  };
}

createRoot(document.getElementById("root")!).render(<App />);

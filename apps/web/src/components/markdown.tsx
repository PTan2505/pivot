"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders user markdown. Raw HTML is not enabled, so content can't inject markup. */
export function Markdown({ children, interactiveChecks = false }: { children: string; interactiveChecks?: boolean }) {
  const body = children.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  return (
    <div className="prose-sb">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          input: (props) =>
            props.type === "checkbox" ? (
              // Checklist runs are ephemeral: ticking doesn't change the saved template.
              <input type="checkbox" defaultChecked={props.checked} disabled={!interactiveChecks} className="mr-2 size-3.5 translate-y-0.5 accent-[var(--primary)]" />
            ) : (
              <input {...props} />
            ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

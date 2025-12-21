import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Style code blocks
          code({ inline, className, children, ...props }: any) {
            return inline ? (
              <code
                className="bg-muted px-1 py-0.5 rounded text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code
                className={`block bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto ${className || ''}`}
                {...props}
              >
                {children}
              </code>
            );
          },
          // Style tables
          table({ children, ...props }: any) {
            return (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          th({ children, ...props }: any) {
            return (
              <th
                className="border border-border px-3 py-2 text-left bg-muted font-medium"
                {...props}
              >
                {children}
              </th>
            );
          },
          td({ children, ...props }: any) {
            return (
              <td className="border border-border px-3 py-2" {...props}>
                {children}
              </td>
            );
          },
          // Style links
          a({ children, href, ...props }: any) {
            return (
              <a
                href={href}
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          // Style headings
          h1({ children, ...props }: any) {
            return (
              <h1 className="text-2xl font-bold mt-6 mb-4 border-b border-border pb-2" {...props}>
                {children}
              </h1>
            );
          },
          h2({ children, ...props }: any) {
            return (
              <h2 className="text-xl font-semibold mt-5 mb-3" {...props}>
                {children}
              </h2>
            );
          },
          h3({ children, ...props }: any) {
            return (
              <h3 className="text-lg font-medium mt-4 mb-2" {...props}>
                {children}
              </h3>
            );
          },
          // Style lists
          ul({ children, ...props }: any) {
            return (
              <ul className="list-disc list-inside space-y-1 my-2" {...props}>
                {children}
              </ul>
            );
          },
          ol({ children, ...props }: any) {
            return (
              <ol className="list-decimal list-inside space-y-1 my-2" {...props}>
                {children}
              </ol>
            );
          },
          // Style blockquotes
          blockquote({ children, ...props }: any) {
            return (
              <blockquote
                className="border-l-4 border-primary pl-4 italic my-4 text-muted-foreground"
                {...props}
              >
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

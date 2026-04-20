import { useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(getText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-gray-700/80 text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-600 transition-all z-10"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function CodeBlockWrapper({ children }: { children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative group my-3" ref={wrapperRef}>
      <CopyButton getText={() => wrapperRef.current?.querySelector('code')?.textContent || ''} />
      <pre className="overflow-x-auto rounded-lg !p-4 !bg-[#1e1e2e] !text-gray-100 text-sm leading-relaxed">
        {children}
      </pre>
    </div>
  )
}

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeBlockWrapper>{children}</CodeBlockWrapper>,
          code: ({ className, children, ...props }) => {
            const isBlock = className && (className.includes('hljs') || className.includes('language-'))
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            }
            return (
              <code
                className="!px-1.5 !py-0.5 !rounded !bg-gray-200 dark:!bg-gray-700 !text-sm !font-mono !text-gray-700 dark:!text-gray-300"
                {...props}
              >
                {children}
              </code>
            )
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="!text-blue-500 hover:!text-blue-400 !underline"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="!text-sm">{children}</table>
            </div>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

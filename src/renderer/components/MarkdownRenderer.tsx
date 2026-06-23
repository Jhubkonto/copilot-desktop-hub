import { memo, useRef, useState, type ReactNode } from 'react'
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
      className="px-2 py-0.5 text-[11px] rounded bg-gray-700/80 text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-600 transition-all shrink-0"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function extractLang(className?: string): string | null {
  if (!className) return null
  const match = /language-(\w+)/.exec(className)
  return match ? match[1] : null
}

function CodeBlockWrapper({ children, lang }: { children: ReactNode; lang: string | null }) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-gray-700/60" ref={wrapperRef}>
      {/* Header bar: language badge + copy button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-gray-700/60">
        <span className="text-[11px] font-mono font-medium text-gray-400 uppercase tracking-wider">
          {lang ?? 'code'}
        </span>
        <CopyButton getText={() => wrapperRef.current?.querySelector('code')?.textContent ?? ''} />
      </div>
      <pre className="code-scrollbar overflow-x-auto !p-4 !m-0 !bg-[#1e1e2e] !text-gray-100 text-sm leading-relaxed !rounded-none">
        {children}
      </pre>
    </div>
  )
}

interface MarkdownRendererProps {
  content: string
}

function MarkdownRendererBase({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body prose prose-sm dark:prose-invert max-w-none break-words
      prose-blockquote:border-l-2 prose-blockquote:border-gray-300 dark:prose-blockquote:border-gray-600
      prose-blockquote:bg-gray-50 dark:prose-blockquote:bg-gray-800/40
      prose-blockquote:px-3 prose-blockquote:py-0.5 prose-blockquote:rounded-r
      prose-blockquote:not-italic prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400
      prose-ul:my-1 prose-ol:my-1
      prose-li:my-0.5
      prose-th:bg-gray-100 dark:prose-th:bg-gray-800
      prose-tr:even:bg-gray-50 dark:prose-tr:even:bg-gray-800/40"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => {
            // Extract lang from the nested <code> className
            let lang: string | null = null
            const child = Array.isArray(children) ? children[0] : children
            if (child && typeof child === 'object' && 'props' in child) {
              lang = extractLang((child as { props?: { className?: string } }).props?.className)
            }
            return <CodeBlockWrapper lang={lang}>{children}</CodeBlockWrapper>
          },
          code: ({ className, children, ...props }) => {
            const isBlock = className && (className.includes('hljs') || className.includes('language-'))
            if (isBlock) {
              return <code className={className} {...props}>{children}</code>
            }
            return (
              <code
                className="!px-1.5 !py-0.5 !rounded !bg-gray-200 dark:!bg-gray-700 !text-[0.8em] !font-mono !text-gray-700 dark:!text-gray-300 !font-normal"
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
            <div className="overflow-x-auto my-3 rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="!text-sm !my-0 w-full">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="!px-3 !py-2 !text-left !font-semibold !text-xs !uppercase !tracking-wide !text-gray-500 dark:!text-gray-400">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="!px-3 !py-2 !text-sm">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownRenderer = memo(MarkdownRendererBase)

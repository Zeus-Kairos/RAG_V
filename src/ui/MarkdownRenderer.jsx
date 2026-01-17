import React, { useEffect, useRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

// Configure marked to use highlight.js for code blocks
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

const MarkdownRenderer = ({ content }) => {
  const markdownRef = useRef(null);

  useEffect(() => {
    if (markdownRef.current && content) {
      // Set the HTML content
      markdownRef.current.innerHTML = marked(content);
      
      // Add event listeners to links to open in new tab
      const links = markdownRef.current.querySelectorAll('a');
      links.forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      });
    }
  }, [content]);

  if (!content) return null;

  return (
    <div 
      ref={markdownRef}
      className="markdown-renderer"
      style={{
        lineHeight: '1.6',
        fontSize: '16px',
        width: '100%',
        display: 'block',
      }}
    >
      {/* Inline style to override highlight.js backgrounds and table styles */}
      <style>{`
        .markdown-renderer pre {
          background-color: transparent !important;
          padding: 0 !important;
          margin: 0 !important;
        }
        .markdown-renderer code {
          background-color: rgba(0, 0, 0, 0.05) !important;
          padding: 0.2em 0.4em !important;
          border-radius: 3px !important;
        }
        .markdown-renderer pre code {
          background-color: transparent !important;
          padding: 0 !important;
        }
        /* Override table header background */
        .markdown-renderer table {
          border-collapse: collapse;
          width: 100%;
        }
        .markdown-renderer th {
          background-color: #F5F0E8 !important; /* Slightly darker background for table headers */
          color: #202124 !important;
          border: 1px solid #e0e0e0 !important;
          padding: 8px !important;
          text-align: left !important;
          font-weight: 600 !important;
        }
        .markdown-renderer td {
          border: 1px solid #e0e0e0 !important;
          padding: 8px !important;
        }
        .markdown-renderer tr:nth-child(even) {
          background-color: rgba(0, 0, 0, 0.02) !important;
        }
      `}</style>
    </div>
  );
};

export default MarkdownRenderer;
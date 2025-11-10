import os
import io
import tempfile
import logging
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Request, Form
from fastapi.responses import Response, HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
from dotenv import load_dotenv

from projects.scheduling_engine.scheduling_engine import (
    text_to_markdown_table,
    export_to_excel,
    export_timeline_to_powerpoint
)
from projects.scheduling_engine.format_converter import convert_plan_format_to_standard
from middleware import ActivityLoggingMiddleware
from database import init_db, test_connection

# Load environment variables from .env file
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", 1048576))

app = FastAPI(
    title="Noodle Planner API",
    description="Project planning and scheduling tool",
    version="1.0.0"
)

# Add activity logging middleware
app.add_middleware(ActivityLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup"""
    logger.info("Starting up application...")
    if test_connection():
        logger.info("Database connection successful")
        logger.info("Note: Database schema is managed via Alembic migrations")
        logger.info("Run 'alembic upgrade head' to apply pending migrations")
    else:
        logger.warning("Database connection failed - activity logging may not work")


class RenderRequest(BaseModel):
    plan_text: str = Field(..., max_length=MAX_FILE_SIZE)
    project_name: Optional[str] = Field(None, max_length=200)
    export_excel: bool = Field(False)
    export_ppt: bool = Field(False)


HTML_CONTENT = r"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Noodle Planner - Project Planning Tool</title>

    <!-- Favicon -->
    <link rel="icon" type="image/png" href="/favicon.png">

    <!-- Bootstrap CSS -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #108BB9 0%, #4B9C4C 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 10px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }

        header {
            background: linear-gradient(135deg, #108BB9 0%, #4B9C4C 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }

        h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }

        .subtitle {
            font-size: 1.2em;
            opacity: 0.9;
        }

        .content {
            padding: 30px;
        }

        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            border-bottom: 2px solid #e0e0e0;
        }

        .tab {
            padding: 10px 20px;
            cursor: pointer;
            background: none;
            border: none;
            font-size: 1em;
            color: #666;
            border-bottom: 3px solid transparent;
            transition: all 0.3s;
        }

        .tab:hover {
            color: #667eea;
        }

        .tab.active {
            color: #667eea;
            border-bottom-color: #667eea;
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        .editor-layout {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            height: calc(100vh - 280px);
            min-height: 500px;
        }

        .editor-panel, .output-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
            min-height: 0;
        }

        .panel-header {
            font-weight: 600;
            margin-bottom: 10px;
            color: #667eea;
            font-size: 1.1em;
        }

        .upload-area {
            border: 3px dashed #667eea;
            border-radius: 10px;
            padding: 40px;
            text-align: center;
            background: #f8f9ff;
            transition: all 0.3s;
            cursor: pointer;
        }

        .upload-area:hover,
        .upload-area.dragover {
            background: #e8ebff;
            border-color: #764ba2;
        }

        .upload-icon {
            font-size: 3em;
            margin-bottom: 20px;
        }

        .editor-wrapper {
            display: flex;
            flex: 1;
            background: #1e1e1e;
            border-radius: 5px;
            overflow: hidden;
            border: 2px solid #3a3a3a;
            min-height: 0;
            position: relative;
        }

        .editor-wrapper:focus-within {
            border-color: #667eea;
        }

        .editor-highlight-layer {
            position: absolute;
            top: 0;
            left: 50px;
            right: 0;
            bottom: 0;
            padding: 15px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.5;
            white-space: pre;
            overflow: auto;
            pointer-events: none;
            color: #d4d4d4;
            z-index: 1;
        }

        .editor-textarea {
            position: relative;
            z-index: 2;
            background: transparent !important;
            color: transparent !important;
            caret-color: #d4d4d4;
        }

        .editor-textarea::selection {
            background: rgba(102, 126, 234, 0.5);
            color: transparent;
        }

        /* Syntax highlighting colors */
        .syntax-duration {
            color: #ce9178;
        }

        .syntax-resource {
            color: #4ec9b0;
        }

        .syntax-percent {
            color: #b5cea8;
        }

        .syntax-comment {
            color: #6a9955;
            font-style: italic;
        }

        .syntax-date {
            color: #dcdcaa;
        }

        .syntax-dependency {
            color: #569cd6;
        }

        .syntax-star {
            color: #858585;
        }

        .line-numbers {
            background: #2d2d2d;
            color: #858585;
            padding: 15px 10px;
            text-align: right;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.5;
            user-select: none;
            overflow-y: hidden;
            overflow-x: hidden;
            min-width: 50px;
            white-space: pre;
        }

        textarea {
            flex: 1;
            padding: 15px;
            border: none;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.5;
            resize: none;
            white-space: pre;
            overflow: auto;
            overflow-wrap: normal;
            min-height: 0;
        }

        textarea:not(.editor-textarea) {
            background: #1e1e1e;
            color: #d4d4d4;
        }

        textarea:focus {
            outline: none;
        }

        textarea::placeholder {
            color: #666;
        }

        textarea {
            cursor: text;
        }

        textarea:hover {
            cursor: text;
        }

        .output-container {
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 20px;
            border-radius: 5px;
            flex: 1;
            overflow: auto;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            white-space: pre;
            min-height: 0;
        }

        .output-container.empty {
            display: flex;
            align-items: center;
            justify-content: center;
            color: #666;
            font-style: italic;
        }

        .options {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }

        .option-group {
            display: flex;
            flex-direction: column;
        }

        label {
            font-weight: 600;
            margin-bottom: 5px;
            color: #555;
        }

        input[type="text"] {
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 5px;
            font-size: 14px;
        }

        input[type="text"]:focus {
            outline: none;
            border-color: #667eea;
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 10px 0;
        }

        input[type="checkbox"] {
            width: 20px;
            height: 20px;
            cursor: pointer;
        }

        .btn {
            background: linear-gradient(135deg, #108BB9 0%, #4B9C4C 100%);
            color: white;
            padding: 15px 30px;
            border: none;
            border-radius: 5px;
            font-size: 1.1em;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            width: 100%;
            margin-top: 20px;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-top: 20px;
        }

        .message {
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            display: none;
        }

        .message.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }

        .message.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }

        .syntax-guide {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 5px;
            margin-top: 20px;
        }

        .syntax-guide h3 {
            margin: 20px 0 15px 0;
            color: #667eea;
        }

        .syntax-guide code {
            background: #e9ecef;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
        }

        .syntax-guide ul {
            list-style-position: inside;
            margin-left: 20px;
        }

        .syntax-guide li {
            margin: 8px 0;
        }

        .syntax-guide pre {
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
            font-size: 13px;
        }

        .spinner {
            display: none;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }

        .output-panel {
            position: relative;
        }

        @keyframes spin {
            0% { transform: translate(-50%, -50%) rotate(0deg); }
            100% { transform: translate(-50%, -50%) rotate(360deg); }
        }

        .hidden {
            display: none;
        }

        /* Mobile responsive styles */
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }

            h1 {
                font-size: 1.8em;
            }

            .subtitle {
                font-size: 1em;
            }

            header {
                padding: 20px;
            }

            .content {
                padding: 15px;
            }

            .editor-layout {
                grid-template-columns: 1fr;
                height: auto;
                min-height: auto;
                gap: 15px;
            }

            .editor-panel, .output-panel {
                height: auto;
                min-height: 400px;
            }

            .tabs {
                flex-wrap: wrap;
                gap: 5px;
            }

            .tab {
                padding: 8px 15px;
                font-size: 0.9em;
            }

            .options {
                grid-template-columns: 1fr;
                gap: 15px;
            }

            .btn-group {
                grid-template-columns: 1fr;
                gap: 10px;
            }

            .editor-wrapper {
                min-height: 300px;
            }

            .output-container {
                min-height: 300px;
            }
        }

        @media (max-width: 480px) {
            h1 {
                font-size: 1.5em;
            }

            .subtitle {
                font-size: 0.9em;
            }

            header {
                padding: 15px;
            }

            .content {
                padding: 10px;
            }

            textarea {
                font-size: 12px;
            }

            .output-container {
                font-size: 11px;
            }
        }

        /* Task Form Modal */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            z-index: 1000;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .modal-overlay.active {
            display: flex;
        }

        .task-form-modal {
            background: white;
            border-radius: 10px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            max-width: 600px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
            from {
                transform: translateY(-50px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        .modal-header {
            background: linear-gradient(135deg, #108BB9 0%, #4B9C4C 100%);
            color: white;
            padding: 20px 30px;
            border-radius: 10px 10px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .modal-header h2 {
            margin: 0;
            font-size: 1.5em;
            padding: 5px;
            border-radius: 4px;
            transition: background-color 0.2s;
        }

        .modal-header h2:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }

        .modal-header h2:focus {
            background-color: rgba(255, 255, 255, 0.2);
        }

        .close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 2em;
            cursor: pointer;
            line-height: 0.8;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 5px;
            transition: background 0.2s;
        }

        .close-btn:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .modal-body {
            padding: 30px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            font-weight: 600;
            margin-bottom: 8px;
            color: #333;
        }

        .form-group input[type="text"],
        .form-group input[type="number"],
        .form-group textarea,
        .form-group select {
            width: 100%;
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 5px;
            font-size: 14px;
            font-family: inherit;
            transition: border-color 0.2s;
        }

        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
            outline: none;
            border-color: #108BB9;
        }

        .form-group textarea {
            resize: vertical;
            min-height: 80px;
        }

        .form-group small {
            display: block;
            margin-top: 5px;
            color: #666;
            font-size: 0.9em;
        }

        .form-actions {
            display: flex;
            gap: 10px;
            margin-top: 30px;
        }

        .btn-primary {
            flex: 1;
            background: linear-gradient(135deg, #108BB9 0%, #4B9C4C 100%);
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 5px;
            font-size: 1em;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(16, 139, 185, 0.4);
        }

        .btn-secondary {
            flex: 1;
            background: #6c757d;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 5px;
            font-size: 1em;
            cursor: pointer;
            transition: transform 0.2s;
        }

        .btn-secondary:hover {
            background: #5a6268;
            transform: translateY(-2px);
        }

        /* Autocomplete dropdown styles */
        .autocomplete-container {
            position: relative;
        }

        .autocomplete-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: white;
            border: 2px solid #108BB9;
            border-top: none;
            border-radius: 0 0 5px 5px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }

        .autocomplete-item {
            padding: 10px;
            cursor: pointer;
            border-bottom: 1px solid #e0e0e0;
        }

        .autocomplete-item:last-child {
            border-bottom: none;
        }

        .autocomplete-item:hover,
        .autocomplete-item.selected {
            background-color: #e8f4f8;
        }

        @media (max-width: 480px) {
            .modal-body {
                padding: 20px;
            }

            .form-actions {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <img src="/logo.png" alt="Noodle Planner" style="height: 120px; display: block; margin: 0 auto;">
        </header>

        <div class="content">
            <div class="tabs">
                <button class="tab active" onclick="switchTab('editor')">Editor</button>
                <button class="tab" onclick="switchTab('upload')">Upload File</button>
                <button class="tab" onclick="switchTab('guide')">Syntax Guide</button>
            </div>

            <div id="editor-tab" class="tab-content active">
                <div class="editor-layout">
                    <div class="editor-panel">
                        <div class="panel-header">📝 Plan Editor</div>
                        <div style="padding: 8px 15px; background: #e8f4f8; border-left: 4px solid #108BB9; margin-bottom: 10px; font-size: 0.9em; color: #333;">
                            💡 <strong>Tip:</strong> Double-click any task line to edit it in the form
                        </div>
                        <div class="editor-wrapper">
                            <div class="line-numbers" id="lineNumbers">1</div>
                            <div class="editor-highlight-layer" id="highlightLayer"></div>
                            <textarea id="planEditor" class="editor-textarea" placeholder="Type or paste your project plan here...

Example:
---
title: My Project
Resources:
- @Alice: Alice Smith, Developer
- @Bob: Bob Jones, Designer
---

Phase 1
  Task 1 @Alice 3days 50% \"Initial setup\"
  Task 2 @Bob 2days [depends Task 1]

Press Enter to render..."></textarea>
                        </div>

                        <div class="options" style="margin-top: 10px;">
                            <div class="checkbox-group">
                                <input type="checkbox" id="editorExportExcel">
                                <label for="editorExportExcel">Export to Excel</label>
                            </div>
                            <div class="checkbox-group">
                                <input type="checkbox" id="editorExportPPT">
                                <label for="editorExportPPT">Export to PowerPoint</label>
                            </div>
                        </div>
                        <div class="message" id="editorMessage"></div>
                    </div>

                    <div class="output-panel">
                        <div class="panel-header">📊 Rendered Output</div>
                        <div class="output-container empty" id="editorOutput">Press Enter in the editor to render your plan...</div>
                        <div class="spinner" id="editorSpinner"></div>
                    </div>
                </div>
            </div>

            <div id="upload-tab" class="tab-content">
                <div class="upload-area" id="dropZone">
                    <div class="upload-icon">📋</div>
                    <h3>Drag & Drop your plan file here</h3>
                    <p>or click to browse</p>
                    <input type="file" id="fileInput" accept=".md,.txt" style="display: none;">
                </div>

                <div class="options">
                    <div class="option-group">
                        <label for="uploadProjectName">Project Name (optional):</label>
                        <input type="text" id="uploadProjectName" placeholder="Auto-detected from filename">
                    </div>
                </div>

                <div class="checkbox-group">
                    <input type="checkbox" id="uploadExportExcel">
                    <label for="uploadExportExcel">Export to Excel (with RAG status)</label>
                </div>

                <div class="checkbox-group">
                    <input type="checkbox" id="uploadExportPPT">
                    <label for="uploadExportPPT">Export Timeline to PowerPoint</label>
                </div>

                <button class="btn" id="uploadBtn" onclick="renderFile()" disabled>Render Plan</button>
                <div class="spinner" id="uploadSpinner"></div>
                <div class="message" id="uploadMessage"></div>
                <div class="output-container" id="uploadOutput"></div>
            </div>

            <div id="guide-tab" class="tab-content">
                <div class="syntax-guide">
                    <h3>Plan Format Guide</h3>

                    <h4>Front Matter (Optional)</h4>
                    <ul>
                        <li>Add YAML front matter between <code>---</code> markers</li>
                        <li>Define resources with full names and roles</li>
                        <li>Specify holidays and project manager</li>
                    </ul>
                    <pre>---
title: Sample Project
project manager: Kevin
Resources:
- @Alice: Alice Smith, Developer
- @Bob: Bob Jones, Designer
Holidays:
- 2025-12-25
- 2025-12-26
---</pre>

                    <h4>Phases and Tasks</h4>
                    <ul>
                        <li>Phase names start at the beginning of a line</li>
                        <li>Tasks are indented with 2 spaces</li>
                        <li>Format: <code>TaskName @Resource Duration %Complete "Comment"</code></li>
                        <li>Duration: <code>3days</code>, <code>2d</code>, <code>1week</code></li>
                        <li>Use <code>*</code> for sequential subtasks</li>
                        <li>Use <code>[depends TaskName]</code> for dependencies</li>
                    </ul>
                    <pre>Requirements
  capture requirements @Alice 3days 50% "Interviews"
Design
  Low Level Design @Bob 2days [depends capture requirements]
Build
  develop software @Alice 5days
  * unit testing @Alice 2days
  * integration testing @Bob 1day</pre>

                    <h4>Milestones</h4>
                    <ul>
                        <li>Zero-duration tasks are milestones: <code>0d</code></li>
                        <li>Show as diamond markers (◆) in timeline</li>
                    </ul>

                    <h4>RAG Status</h4>
                    <p>Automatically calculated based on:</p>
                    <ul>
                        <li><strong>Green:</strong> Task complete (100%) or not due to start</li>
                        <li><strong>Amber:</strong> Behind schedule (progress < expected)</li>
                        <li><strong>Red:</strong> Overdue with no progress reported</li>
                    </ul>

                    <h4>Export Options</h4>
                    <ul>
                        <li><strong>ASCII Output:</strong> Always shown in terminal format</li>
                        <li><strong>Excel:</strong> Task table with RAG colors, milestones, and resource sheets</li>
                        <li><strong>PowerPoint:</strong> Visual timeline with phases and milestones</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>

    <script>
        let selectedFile = null;
        let renderTimeout = null;

        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            event.target.classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
        }

        // Initialize editor functionality when DOM is ready
        window.addEventListener('load', function() {
            initializeEditor();
            initializeUploadTab();
        });

        function initializeEditor() {
            const editor = document.getElementById('planEditor');
            const lineNumbers = document.getElementById('lineNumbers');
            const highlightLayer = document.getElementById('highlightLayer');

            if (!editor || !lineNumbers) {
                console.error('Editor or line numbers not found');
                return;
            }

            // Syntax highlighting function
            function highlightSyntax(text) {
                return text.split('\n').map(line => {
                    // Skip empty lines and headers
                    if (!line.trim() || line.includes('===') || line.includes('---')) {
                        return line;
                    }

                    // Escape HTML first to prevent issues
                    let highlighted = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');

                    // Use placeholder strategy to avoid regex conflicts
                    const placeholders = [];
                    let placeholderIndex = 0;

                    function savePlaceholder(replacement) {
                        const placeholder = `__PLACEHOLDER_${placeholderIndex}__`;
                        placeholders.push({ placeholder, replacement });
                        placeholderIndex++;
                        return placeholder;
                    }

                    // Highlight comments (text in quotes) - do first to protect from other replacements
                    highlighted = highlighted.replace(/"([^"]*)"/g, (match, content) => {
                        return savePlaceholder('<span class="syntax-comment">"' + content + '"</span>');
                    });

                    // Highlight star prefix (depends on previous task) - match * at line start
                    highlighted = highlighted.replace(/^(\s*)(\*)/, (match, space, star) => {
                        return space + savePlaceholder('<span class="syntax-star">' + star + '</span>');
                    });

                    // Highlight durations (e.g., 3d, 5w, 2m)
                    highlighted = highlighted.replace(/\b(\d+[dmw])\b/g, (match, duration) => {
                        return savePlaceholder('<span class="syntax-duration">' + duration + '</span>');
                    });

                    // Highlight resources (e.g., @alice, @bob)
                    highlighted = highlighted.replace(/@(\w+)/g, (match, name) => {
                        return savePlaceholder('<span class="syntax-resource">@' + name + '</span>');
                    });

                    // Highlight percentages (e.g., 50%, 75%)
                    highlighted = highlighted.replace(/\b(\d+%)/g, (match, percent) => {
                        return savePlaceholder('<span class="syntax-percent">' + percent + '</span>');
                    });

                    // Highlight ISO dates (e.g., 2025-11-10)
                    highlighted = highlighted.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (match, date) => {
                        return savePlaceholder('<span class="syntax-date">' + date + '</span>');
                    });

                    // Highlight dependencies (e.g., #Design, #Task1)
                    highlighted = highlighted.replace(/#(\w+)/g, (match, name) => {
                        return savePlaceholder('<span class="syntax-dependency">#' + name + '</span>');
                    });

                    // Replace all placeholders with actual HTML
                    placeholders.forEach(({ placeholder, replacement }) => {
                        highlighted = highlighted.replace(placeholder, replacement);
                    });

                    return highlighted;
                }).join('\n');
            }

            // Update line numbers and syntax highlighting
            function updateLineNumbers() {
                const content = editor.value || editor.placeholder || '';
                const lines = content.split('\n');
                const lineCount = lines.length;

                let numbersText = '';
                for (let i = 1; i <= lineCount; i++) {
                    numbersText += i + '\n';
                }

                lineNumbers.textContent = numbersText.trim();

                // Update syntax highlighting
                if (highlightLayer) {
                    const highlighted = highlightSyntax(content);
                    highlightLayer.innerHTML = highlighted;
                }
            }

            // Sync scroll
            function syncScroll() {
                lineNumbers.scrollTop = editor.scrollTop;
                if (highlightLayer) {
                    highlightLayer.scrollTop = editor.scrollTop;
                    highlightLayer.scrollLeft = editor.scrollLeft;
                }
            }

            // Initialize
            updateLineNumbers();

            // Update on input
            editor.addEventListener('input', updateLineNumbers);

            // Sync scroll
            editor.addEventListener('scroll', syncScroll);

            // Render on Enter - use input event after Enter to catch the newline
            editor.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    setTimeout(renderText, 10);
                }
            });
        }

        function initializeUploadTab() {
            const dropZone = document.getElementById('dropZone');
            const fileInput = document.getElementById('fileInput');
            const uploadBtn = document.getElementById('uploadBtn');

            if (!dropZone || !fileInput || !uploadBtn) {
                console.error('Upload elements not found');
                return;
            }

            dropZone.addEventListener('click', () => fileInput.click());

            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragover');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    handleFile(files[0]);
                }
            });

            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    handleFile(e.target.files[0]);
                }
            });
        }

        function handleFile(file) {
            if (!file.name.match(/\\.(md|txt)$/i)) {
                showMessage('upload', 'error', 'Please select a Markdown (.md) or text (.txt) file');
                return;
            }

            if (file.size > 1048576) {
                showMessage('upload', 'error', 'File size must be less than 1MB');
                return;
            }

            selectedFile = file;
            uploadBtn.disabled = false;
            dropZone.innerHTML = '<div class="upload-icon">✓</div><h3>' + file.name + '</h3><p>Ready to render</p>';

            if (!document.getElementById('uploadProjectName').value) {
                const name = file.name.replace(/\\.(md|txt)$/i, '').replace(/_/g, ' ');
                document.getElementById('uploadProjectName').value = name;
            }
        }

        async function renderFile() {
            if (!selectedFile) return;

            const text = await selectedFile.text();
            const projectName = document.getElementById('uploadProjectName').value;
            const exportExcel = document.getElementById('uploadExportExcel').checked;
            const exportPPT = document.getElementById('uploadExportPPT').checked;

            await render(text, projectName, exportExcel, exportPPT, 'upload');
        }

        async function renderText() {
            const text = document.getElementById('planEditor').value.trim();

            if (!text) {
                const output = document.getElementById('editorOutput');
                output.textContent = 'Press Enter in the editor to render your plan...';
                output.classList.add('empty');
                return;
            }

            const exportExcel = document.getElementById('editorExportExcel').checked;
            const exportPPT = document.getElementById('editorExportPPT').checked;

            await render(text, null, exportExcel, exportPPT, 'editor');
        }

        async function render(planText, projectName, exportExcel, exportPPT, prefix) {
            const btn = document.getElementById(prefix + 'Btn');
            const spinner = document.getElementById(prefix + 'Spinner');
            const message = document.getElementById(prefix + 'Message');
            const output = document.getElementById(prefix + 'Output');

            if (btn) btn.disabled = true;
            spinner.style.display = 'block';
            message.style.display = 'none';
            output.classList.remove('empty');

            try {
                const data = {
                    plan_text: planText,
                    project_name: projectName || null,
                    export_excel: exportExcel,
                    export_ppt: exportPPT
                };

                const response = await fetch('/render', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Rendering failed');
                }

                const contentType = response.headers.get('content-type');

                if (contentType.includes('application/json')) {
                    // ASCII output
                    const result = await response.json();
                    output.textContent = result.ascii_output;
                    if (prefix === 'editor') {
                        showMessage(prefix, 'success', 'Rendered!');
                        setTimeout(() => {
                            message.style.display = 'none';
                        }, 2000);
                    } else {
                        showMessage(prefix, 'success', 'Plan rendered successfully!');
                    }
                } else if (contentType.includes('application/zip')) {
                    // Download ZIP file
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = (projectName || 'project') + '-exports.zip';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);

                    // Also show ASCII output (need to re-render)
                    const asciiResponse = await fetch('/render', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...data, export_excel: false, export_ppt: false })
                    });
                    const result = await asciiResponse.json();
                    output.textContent = result.ascii_output;

                    showMessage(prefix, 'success', 'Exports downloaded successfully!');
                }
            } catch (error) {
                showMessage(prefix, 'error', error.message);
                output.textContent = 'Error: ' + error.message;
            } finally {
                if (btn) btn.disabled = false;
                spinner.style.display = 'none';
            }
        }

        function showMessage(prefix, type, text) {
            const message = document.getElementById(prefix + 'Message');
            message.className = 'message ' + type;
            message.textContent = text;
            message.style.display = 'block';

            if (type === 'success') {
                setTimeout(() => {
                    message.style.display = 'none';
                }, 5000);
            }
        }

        // Task Form Modal Functions
        let currentTask = null;  // Will hold the Task instance being edited
        let userSetStartDate = false;  // Track if user explicitly set start date
        let userSetFinishDate = false;  // Track if user explicitly set finish date
        let userSetDuration = false;  // Track if user explicitly set duration

        // Task class to manage task state
        class Task {
            constructor(lineNumber, lineText) {
                this.lineNumber = lineNumber;
                this.originalLine = lineText || '';
                this.indent = this.extractIndent(lineText);
                this.name = '';
                this.duration = '';
                this.startDate = '';
                this.finishDate = '';
                this.percent = 0;
                this.resources = [];
                this.comment = '';
                this.dependencies = [];
                this.dependsOnPrevious = false;

                // Parse the line if provided
                if (lineText) {
                    this.parseFromLine(lineText);
                }
            }

            extractIndent(line) {
                if (!line) return '';
                const match = line.match(/^(\\s*)/);
                return match ? match[1] : '';
            }

            parseFromLine(line) {
                const trimmed = line.trim();
                if (!trimmed) return;

                let remaining = trimmed;

                // Check for * prefix (depends on previous task)
                if (remaining.startsWith('*')) {
                    this.dependsOnPrevious = true;
                    remaining = remaining.substring(1).trim();
                }

                // Extract task name - stop at first: duration, @, #, %, ", or RAG
                const nameMatch = remaining.match(/^([^\\d@#%"]+?)(?=\\s+\\d+d|\\s+@|\\s+#|\\s+\\d+%|\\s+"|$)/);
                if (nameMatch) {
                    this.name = nameMatch[1].trim();
                }

                // Extract duration (e.g., "5d")
                const durationMatch = remaining.match(/\\b(\\d+)d\\b/);
                if (durationMatch) {
                    this.duration = durationMatch[1];
                }

                // Extract percent (e.g., "50%")
                const percentMatch = remaining.match(/\\b(\\d+)%\\b/);
                if (percentMatch) {
                    this.percent = parseInt(percentMatch[1]);
                }

                // Extract resources (all @mentions)
                const resourceMatches = remaining.match(/@([^\\s@#%!"]+)/g);
                if (resourceMatches) {
                    this.resources = resourceMatches.map(r => r.substring(1));
                }

                // Extract dependencies (after #)
                const depMatch = remaining.match(/#([^\\s@%!"]+)/);
                if (depMatch) {
                    this.dependencies = depMatch[1].split(',').map(d => d.trim());
                }

                // Extract comment (text in quotes)
                const commentMatch = remaining.match(/"([^"]*)"/);
                if (commentMatch) {
                    this.comment = commentMatch[1];
                }
            }

            // Calculate duration from dates
            calculateDurationFromDates() {
                if (!this.startDate || !this.finishDate) return null;
                const start = new Date(this.startDate);
                const finish = new Date(this.finishDate);
                const diffTime = Math.abs(finish - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays;
            }

            // Calculate finish date from start + duration
            calculateFinishDateFromDuration() {
                if (!this.startDate || !this.duration) return null;
                const start = new Date(this.startDate);
                const durationDays = parseInt(this.duration);
                if (isNaN(durationDays)) return null;
                const finish = new Date(start);
                finish.setDate(finish.getDate() + durationDays);
                return finish.toISOString().split('T')[0];
            }

            // Reconstruct task line from current state
            toString() {
                let line = this.indent;

                // Add * prefix if depends on previous
                if (this.dependsOnPrevious) {
                    line += '*';
                }

                // Add task name
                line += this.name;

                // Add duration
                if (this.duration) {
                    line += ' ' + this.duration + 'd';
                }

                // Add resources
                if (this.resources.length > 0) {
                    line += ' ' + this.resources.map(r => '@' + r).join(' ');
                }

                // Add non-previous dependencies
                const nonPrevDeps = this.dependencies.filter(d => {
                    // Get previous task name to filter it out
                    const editor = document.getElementById('planEditor');
                    if (editor) {
                        const lines = editor.value.split('\n');
                        const prevName = this.getPreviousTaskName(lines);
                        return d !== prevName;
                    }
                    return true;
                });

                if (nonPrevDeps.length > 0) {
                    line += ' #' + nonPrevDeps.join(',');
                }

                // Add percent
                if (this.percent > 0) {
                    line += ' ' + this.percent + '%';
                }

                // Add comment
                if (this.comment) {
                    line += ' "' + this.comment + '"';
                }

                return line;
            }

            getPreviousTaskName(lines) {
                // Find the previous non-empty task line
                for (let i = this.lineNumber - 2; i >= 0; i--) {
                    const line = lines[i].trim();
                    if (line && !line.includes('===') && !line.includes('---') && !line.startsWith('#')) {
                        // Extract task name
                        let taskLine = line;
                        if (taskLine.startsWith('*')) {
                            taskLine = taskLine.substring(1).trim();
                        }
                        const nameMatch = taskLine.match(/^([^\\d@#%"]+?)(?=\\s+\\d+d|\\s+@|\\s+#|\\s+\\d+%|\\s+"|$)/);
                        if (nameMatch) {
                            return nameMatch[1].trim();
                        }
                    }
                }
                return null;
            }

            // Update task in editor
            updateInEditor() {
                const editor = document.getElementById('planEditor');
                if (!editor) return;

                const lines = editor.value.split('\n');
                lines[this.lineNumber - 1] = this.toString();
                editor.value = lines.join('\n');

                // Trigger render
                setTimeout(() => renderText(), 10);
            }
        }

        // Check if a date is a weekend (Saturday or Sunday)
        function isWeekend(date) {
            const day = date.getDay();
            return day === 0 || day === 6; // Sunday=0, Saturday=6
        }

        // Get the next working day (skip weekends)
        function getNextWorkingDay(date) {
            const result = new Date(date);
            while (isWeekend(result)) {
                result.setDate(result.getDate() + 1);
            }
            return result;
        }

        // Add working days to a start date, skipping weekends
        // Returns the finish date (end of the last working day)
        function addWorkingDays(startDate, numDays) {
            if (numDays === 0) {
                // Zero-duration tasks (milestones) finish on the same day
                return new Date(startDate);
            }

            // Ensure we start from a working day
            let current = getNextWorkingDay(new Date(startDate));
            let daysAdded = 0;

            while (daysAdded < numDays) {
                // If current day is a working day, count it
                if (!isWeekend(current)) {
                    daysAdded++;
                }
                // Move to next day
                current.setDate(current.getDate() + 1);
            }

            return current;
        }

        // Calculate dates for a task, looking up dependency dates from a task map
        function calculateTaskDates(task, taskMap, lines) {
            // If task already has both dates, return it
            if (task.startDate && task.finishDate) {
                return task;
            }

            // Try to calculate from dependencies
            if (task.dependencies && !task.startDate) {
                const depNames = task.dependencies.split(',').map(d => d.trim());
                let latestFinishDate = null;

                for (const depName of depNames) {
                    // Look up dependency in the map
                    const depTask = taskMap.get(depName);
                    if (depTask) {
                        // Recursively calculate dependency dates if not set
                        if (!depTask.finishDate) {
                            calculateTaskDates(depTask, taskMap, lines);
                        }
                        if (depTask.finishDate) {
                            if (!latestFinishDate || depTask.finishDate > latestFinishDate) {
                                latestFinishDate = depTask.finishDate;
                            }
                        }
                    }
                }

                // If we found a dependency finish date, calculate start date
                if (latestFinishDate) {
                    // Start on the same day the dependency finishes
                    task.startDate = latestFinishDate;
                }
            }

            // If no start date yet, default to today
            if (!task.startDate) {
                const today = new Date();
                task.startDate = today.toISOString().split('T')[0];
            }

            // Calculate finish date from start date and duration, skipping weekends
            if (!task.finishDate) {
                const duration = task.duration || '1'; // Default to 1 day if no duration
                const durationDays = parseInt(duration);
                const start = new Date(task.startDate);
                const finish = addWorkingDays(start, durationDays);
                task.finishDate = finish.toISOString().split('T')[0];
            }

            // Ensure duration is set
            if (!task.duration) {
                if (task.startDate && task.finishDate) {
                    const start = new Date(task.startDate);
                    const finish = new Date(task.finishDate);
                    const diffDays = Math.ceil((finish - start) / (1000 * 60 * 60 * 24));
                    task.duration = diffDays.toString();
                } else {
                    task.duration = '1'; // Default duration
                }
            }

            return task;
        }

        function openTaskForm(lineNumber) {
            const editor = document.getElementById('planEditor');
            const lines = editor.value.split('\n');
            const taskLine = lines[lineNumber - 1];

            // Parse task details from line
            const task = parseTaskLine(taskLine, lineNumber);

            // Track which fields were in the original task (user set)
            const originalStartDate = task.startDate;
            const originalFinishDate = task.finishDate;
            const originalDuration = task.duration;

            // Build a map of all tasks by name for dependency lookup
            const taskMap = new Map();
            for (let i = 0; i < lines.length; i++) {
                const t = parseTaskLine(lines[i], i + 1);
                if (t.name) {
                    taskMap.set(t.name, t);
                }
            }

            // Calculate dates for this task (will recursively calculate dependencies)
            calculateTaskDates(task, taskMap, lines);

            // Mark which fields are user-set vs auto-calculated
            userSetStartDate = !!originalStartDate;
            userSetFinishDate = !!originalFinishDate;
            userSetDuration = !!originalDuration;

            // Populate form
            document.getElementById('taskName').value = task.name || '';
            document.getElementById('taskFormTitle').textContent = task.name || 'Task Name';

            const durationField = document.getElementById('taskDuration');
            durationField.value = task.duration || '1';

            const startDateField = document.getElementById('taskStartDate');
            const finishDateField = document.getElementById('taskFinishDate');

            startDateField.value = task.startDate || '';
            finishDateField.value = task.finishDate || '';

            // Style auto-calculated fields as italic
            startDateField.style.fontStyle = userSetStartDate ? 'normal' : 'italic';
            finishDateField.style.fontStyle = userSetFinishDate ? 'normal' : 'italic';
            durationField.style.fontStyle = userSetDuration ? 'normal' : 'italic';

            document.getElementById('taskPercent').value = task.percent || '';
            document.getElementById('taskResources').value = task.resources || '';
            document.getElementById('taskComment').value = task.comment || '';
            document.getElementById('taskDependencies').value = task.dependencies || '';

            currentTaskLineNumber = lineNumber;
            updateRagDisplay();
            updateProgressBar();
            document.getElementById('taskFormOverlay').classList.add('active');
        }

        // Called when date fields change - recalculate duration
        function onDateChange(field) {
            const startDateField = document.getElementById('taskStartDate');
            const finishDateField = document.getElementById('taskFinishDate');
            const durationField = document.getElementById('taskDuration');
            const startDate = startDateField.value;
            const finishDate = finishDateField.value;

            // Mark which field was changed by user
            if (field === 'start') {
                userSetStartDate = !!startDate;
                startDateField.style.fontStyle = 'normal';
            } else if (field === 'finish') {
                userSetFinishDate = !!finishDate;
                finishDateField.style.fontStyle = 'normal';
            }

            // If both dates exist, calculate duration from them
            if (startDate && finishDate) {
                const start = new Date(startDate);
                const finish = new Date(finishDate);
                const diffTime = Math.abs(finish - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                durationField.value = diffDays;

                // Keep duration as auto-calculated (italic) unless user explicitly set it
                if (!userSetDuration) {
                    durationField.style.fontStyle = 'italic';
                }
            }

            saveTask();
            updateRagDisplay();
        }

        // Called when duration field changes - recalculate finish date
        function onDurationChange() {
            const startDateField = document.getElementById('taskStartDate');
            const finishDateField = document.getElementById('taskFinishDate');
            const durationField = document.getElementById('taskDuration');
            const startDate = startDateField.value;
            const duration = durationField.value;

            // Mark duration as user-set
            userSetDuration = !!duration;
            durationField.style.fontStyle = 'normal';

            // If start date and duration exist, calculate finish date (skipping weekends)
            if (startDate && duration) {
                const durationDays = parseInt(duration);
                if (!isNaN(durationDays)) {
                    const start = new Date(startDate);
                    const finish = addWorkingDays(start, durationDays);
                    finishDateField.value = finish.toISOString().split('T')[0];

                    // Keep finish date as auto-calculated (italic) unless user explicitly set it
                    if (!userSetFinishDate) {
                        finishDateField.style.fontStyle = 'italic';
                    }
                }
            }

            saveTask();
            updateRagDisplay();
        }

        function updateTaskNameFromTitle() {
            const title = document.getElementById('taskFormTitle').textContent.trim();
            document.getElementById('taskName').value = title;
            saveTask();
        }

        function updateRagDisplay() {
            const percent = parseInt(document.getElementById('taskPercent').value) || 0;
            const startDateStr = document.getElementById('taskStartDate').value;
            const finishDateStr = document.getElementById('taskFinishDate').value;
            const ragDisplay = document.getElementById('ragDisplay');
            const ragReasoning = document.getElementById('ragReasoning');

            let ragStatus, bgColor, textColor, reasoning;

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // RAG logic based on backend rules (from calculate_rag_status):

            // Green: Task is 100% complete
            if (percent === 100) {
                ragStatus = 'Green';
                bgColor = '#4caf50';
                textColor = 'white';
                reasoning = 'Task is complete';
            }
            // Green: Task hasn't started yet (start date is in the future)
            else if (startDateStr && new Date(startDateStr) > today) {
                ragStatus = 'Green';
                bgColor = '#4caf50';
                textColor = 'white';
                reasoning = 'Task not due to start yet';
            }
            // Red: Start date is in the past and no progress or 0%
            else if (startDateStr && new Date(startDateStr) <= today && percent === 0) {
                ragStatus = 'Red';
                bgColor = '#f44336';
                textColor = 'white';
                reasoning = 'Task overdue - no progress reported';
            }
            // Calculate expected progress based on dates
            else if (startDateStr && finishDateStr) {
                const startDate = new Date(startDateStr);
                const finishDate = new Date(finishDateStr);
                const totalDuration = (finishDate - startDate) / (1000 * 60 * 60 * 24);
                const elapsedDays = Math.max(0, (today - startDate) / (1000 * 60 * 60 * 24));
                const expectedPercent = Math.min(100, (elapsedDays / Math.max(1, totalDuration)) * 100);

                // Amber: Actual progress is less than expected
                if (percent < expectedPercent) {
                    ragStatus = 'Amber';
                    bgColor = '#ff9800';
                    textColor = 'white';
                    reasoning = 'Behind schedule: ' + percent + '% complete, expected ' + Math.round(expectedPercent) + '%';
                } else {
                    // Green: On track or ahead
                    ragStatus = 'Green';
                    bgColor = '#4caf50';
                    textColor = 'white';
                    reasoning = 'On track or ahead of schedule';
                }
            }
            // Fallback: Use simple percentage thresholds if no dates
            else if (percent === 0) {
                ragStatus = 'Red';
                bgColor = '#f44336';
                textColor = 'white';
                reasoning = 'No progress made';
            } else if (percent < 50) {
                ragStatus = 'Red';
                bgColor = '#f44336';
                textColor = 'white';
                reasoning = 'Progress below 50%';
            } else if (percent < 80) {
                ragStatus = 'Amber';
                bgColor = '#ff9800';
                textColor = 'white';
                reasoning = 'Progress 50-79%';
            } else {
                ragStatus = 'Green';
                bgColor = '#4caf50';
                textColor = 'white';
                reasoning = 'Progress ≥80%';
            }

            ragDisplay.textContent = ragStatus;
            ragDisplay.style.backgroundColor = bgColor;
            ragDisplay.style.color = textColor;
            ragReasoning.textContent = reasoning;
        }

        function updateProgressBar() {
            const percent = parseInt(document.getElementById('taskPercent').value) || 0;
            const progressBar = document.getElementById('progressBar');
            const progressText = document.getElementById('progressText');

            progressBar.style.width = percent + '%';
            progressBar.setAttribute('aria-valuenow', percent);
            progressText.textContent = percent > 0 ? percent + '%' : '';

            // Update color based on percentage
            progressBar.className = 'progress-bar progress-bar-striped';
            if (percent === 100) {
                progressBar.classList.add('bg-success');
            } else if (percent >= 80) {
                progressBar.classList.add('bg-success');
            } else if (percent >= 50) {
                progressBar.classList.add('bg-warning');
            } else if (percent > 0) {
                progressBar.classList.add('bg-danger');
            } else {
                progressBar.classList.add('bg-secondary');
            }
        }

        function closeTaskForm() {
            document.getElementById('taskFormOverlay').classList.remove('active');
            currentTaskLineNumber = null;
        }

        function saveTask() {
            if (currentTaskLineNumber === null) return;

            const editor = document.getElementById('planEditor');
            const lines = editor.value.split('\n');
            const originalLine = lines[currentTaskLineNumber - 1];

            // Safety check - if line doesn't exist, return
            if (!originalLine && originalLine !== '') {
                console.error('Task line not found at line number:', currentTaskLineNumber, 'Total lines:', lines.length);
                return;
            }

            // Get form values
            const name = document.getElementById('taskName').value.trim();
            const duration = document.getElementById('taskDuration').value.trim();
            const startDate = document.getElementById('taskStartDate').value.trim();
            const finishDate = document.getElementById('taskFinishDate').value.trim();
            const percent = document.getElementById('taskPercent').value.trim();
            const resources = document.getElementById('taskResources').value.trim();
            const comment = document.getElementById('taskComment').value.trim();
            const dependencies = document.getElementById('taskDependencies').value.trim();

            // Get previous task name for dependency check
            const previousTaskName = getPreviousTaskName(lines, currentTaskLineNumber);

            // Parse dependencies - split by comma if multiple
            const depList = dependencies ? dependencies.split(',').map(d => d.trim()).filter(d => d) : [];

            // Filter out the previous task from explicit dependencies (will use * instead)
            const nonPreviousDeps = depList.filter(dep => dep !== previousTaskName);

            // Check if task depends on previous task
            const dependsOnPrevious = depList.includes(previousTaskName);

            // Reconstruct task line
            let indent = '';
            try {
                const indentMatch = originalLine.match(/^\s*/);
                if (indentMatch && indentMatch[0] !== undefined) {
                    indent = indentMatch[0];
                } else {
                    console.error('Regex match failed for originalLine:', originalLine);
                }
            } catch (e) {
                console.error('Error matching indent:', e, 'originalLine:', originalLine, 'type:', typeof originalLine);
            }

            let taskNamePart = dependsOnPrevious ? '*' + name : name;
            let newLine = indent + taskNamePart;

            // Add duration
            if (duration) newLine += ' ' + duration + 'd';

            // Add resources - split by comma and add @ prefix to each
            if (resources) {
                const resourceList = resources.split(',').map(r => r.trim()).filter(r => r);
                resourceList.forEach(resource => {
                    newLine += ' @' + resource;
                });
            }

            // Add percent
            if (percent) newLine += ' ' + percent + '%';

            // Add dates (ISO format) - only if user explicitly set them
            if (startDate && userSetStartDate) newLine += ' ' + startDate;
            if (finishDate && userSetFinishDate) newLine += ' ' + finishDate;

            // Add comment
            if (comment) newLine += ' "' + comment + '"';

            // Add dependencies (only non-previous ones, as * handles previous)
            if (nonPreviousDeps.length > 0) newLine += ' #' + nonPreviousDeps.join(',');

            // Update the line
            lines[currentTaskLineNumber - 1] = newLine;
            editor.value = lines.join('\n');

            // Trigger input event to update line numbers and render
            editor.dispatchEvent(new Event('input'));
            setTimeout(() => renderText(), 10);
        }

        function getPreviousTaskName(lines, currentLineNum) {
            // Look backwards from current line to find the previous task
            for (let i = currentLineNum - 2; i >= 0; i--) {
                const line = lines[i].trim();
                // Skip empty lines, phase headers, and summary lines
                if (line && !line.includes('===') && !line.includes('---') && !line.startsWith('#')) {
                    // Parse this line to get just the task name
                    const task = parseTaskLine(line, i + 1);
                    if (task.name) {
                        return task.name;
                    }
                }
            }
            return null;
        }

        function parseTaskLine(line, lineNum) {
            const task = {
                lineNumber: lineNum,
                name: '',
                duration: '',
                startDate: '',
                finishDate: '',
                percent: '',
                resources: '',
                comment: '',
                dependencies: ''
            };

            // Remove leading whitespace
            const trimmed = line.trim();
            if (!trimmed) return task;

            // Check for * prefix (depends on previous task)
            let hasStar = false;
            let text = trimmed;
            if (text.startsWith('*')) {
                hasStar = true;
                text = text.substring(1).trim();
            }

            // Handle comment first (everything in quotes)
            let comment = '';
            const quoteMatch = text.match(/"([^"]*)"/);
            if (quoteMatch) {
                comment = quoteMatch[1];
                // Remove the comment from the text
                text = text.replace(/"[^"]*"/, '').trim();
            }

            // Split by spaces to get tokens
            const tokens = text.split(/\s+/);

            const nameTokens = [];
            const resources = [];
            const dependencies = [];
            const dates = [];

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];

                // Skip empty tokens
                if (!token) continue;

                // Check what type of token this is
                if (token.startsWith('@')) {
                    // Resource: @kev, @jen
                    resources.push(token.substring(1));
                }
                else if (token.startsWith('#')) {
                    // Dependency: #Design
                    dependencies.push(token.substring(1));
                }
                else if (token.match(/^\d+[dmw]$/)) {
                    // Duration: 5d, 2w, 3m
                    const num = token.match(/^(\d+)/)[1];
                    task.duration = num;
                }
                else if (token.match(/^\d+%$/)) {
                    // Percent: 50%
                    const num = token.match(/^(\d+)/)[1];
                    task.percent = num;
                }
                else if (token.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    // ISO Date: 2025-11-11
                    dates.push(token);
                }
                else {
                    // Part of task name
                    nameTokens.push(token);
                }
            }

            // Assemble the results
            task.name = nameTokens.join(' ');
            task.comment = comment;
            task.resources = resources.join(', ');

            // Handle dates
            if (dates.length > 0) {
                task.startDate = dates[0];
                if (dates.length > 1) {
                    task.finishDate = dates[1];
                }
            }

            // Handle dependencies
            if (hasStar) {
                // Add previous task as dependency
                const editor = document.getElementById('planEditor');
                if (editor) {
                    const lines = editor.value.split('\n');
                    const previousTaskName = getPreviousTaskName(lines, lineNum);
                    if (previousTaskName) {
                        dependencies.unshift(previousTaskName);
                    }
                }
            }

            task.dependencies = dependencies.join(', ');

            return task;
        }

        // Autocomplete functionality for dependencies and resources
        let autocompleteSelectedIndex = -1;
        let resourceAutocompleteSelectedIndex = -1;

        function getAllTaskNames() {
            const editor = document.getElementById('planEditor');
            if (!editor) return [];

            const lines = editor.value.split('\n');
            const taskNames = [];

            for (let i = 0; i < lines.length; i++) {
                const task = parseTaskLine(lines[i], i + 1);
                if (task.name && task.name.trim()) {
                    // Don't include the current task
                    if (currentTask && task.lineNumber === currentTask.lineNumber) {
                        continue;
                    }
                    taskNames.push(task.name.trim());
                }
            }

            return taskNames;
        }

        function handleDependencyInput() {
            const input = document.getElementById('taskDependencies');
            const dropdown = document.getElementById('dependencyAutocomplete');
            const value = input.value;

            // Get the current word being typed (after the last comma)
            const lastCommaIndex = value.lastIndexOf(',');
            const currentWord = value.substring(lastCommaIndex + 1).trim();

            if (currentWord.length === 0) {
                dropdown.style.display = 'none';
                autocompleteSelectedIndex = -1;
                saveTask();
                return;
            }

            // Get all task names and filter by current word
            const allTasks = getAllTaskNames();
            const matches = allTasks.filter(name =>
                name.toLowerCase().includes(currentWord.toLowerCase())
            );

            if (matches.length === 0) {
                dropdown.style.display = 'none';
                autocompleteSelectedIndex = -1;
                saveTask();
                return;
            }

            // Build dropdown HTML
            dropdown.innerHTML = '';
            matches.forEach((name, index) => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.textContent = name;
                item.onclick = function() {
                    selectDependency(name);
                };
                dropdown.appendChild(item);
            });

            dropdown.style.display = 'block';
            autocompleteSelectedIndex = -1;
            saveTask();
        }

        function handleDependencyKeydown(event) {
            const dropdown = document.getElementById('dependencyAutocomplete');
            if (dropdown.style.display !== 'block') return;

            const items = dropdown.querySelectorAll('.autocomplete-item');
            if (items.length === 0) return;

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                autocompleteSelectedIndex = Math.min(autocompleteSelectedIndex + 1, items.length - 1);
                updateAutocompleteSelection(items);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                autocompleteSelectedIndex = Math.max(autocompleteSelectedIndex - 1, -1);
                updateAutocompleteSelection(items);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (autocompleteSelectedIndex >= 0) {
                    const selectedItem = items[autocompleteSelectedIndex];
                    selectDependency(selectedItem.textContent);
                }
            } else if (event.key === 'Escape') {
                dropdown.style.display = 'none';
                autocompleteSelectedIndex = -1;
            }
        }

        function updateAutocompleteSelection(items) {
            items.forEach((item, index) => {
                if (index === autocompleteSelectedIndex) {
                    item.classList.add('selected');
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.classList.remove('selected');
                }
            });
        }

        function selectDependency(name) {
            const input = document.getElementById('taskDependencies');
            const value = input.value;

            // Replace the current word being typed with the selected name
            const lastCommaIndex = value.lastIndexOf(',');
            let newValue;
            if (lastCommaIndex >= 0) {
                newValue = value.substring(0, lastCommaIndex + 1) + ' ' + name;
            } else {
                newValue = name;
            }

            input.value = newValue;
            const dropdown = document.getElementById('dependencyAutocomplete');
            dropdown.style.display = 'none';
            autocompleteSelectedIndex = -1;
            input.focus();
            saveTask();
        }

        // Autocomplete functionality for resources
        function getAllResourceNames() {
            const editor = document.getElementById('planEditor');
            if (!editor) return [];

            const lines = editor.value.split('\n');
            const resourceSet = new Set();

            for (let i = 0; i < lines.length; i++) {
                const task = parseTaskLine(lines[i], i + 1);
                if (task.resources) {
                    // Split resources by comma and add each one
                    const resources = task.resources.split(',').map(r => r.trim()).filter(r => r);
                    resources.forEach(r => resourceSet.add(r));
                }
            }

            return Array.from(resourceSet).sort();
        }

        function handleResourceInput() {
            const input = document.getElementById('taskResources');
            const dropdown = document.getElementById('resourceAutocomplete');
            const value = input.value;

            // Get the current word being typed (after the last comma)
            const lastCommaIndex = value.lastIndexOf(',');
            const currentWord = value.substring(lastCommaIndex + 1).trim();

            if (currentWord.length === 0) {
                dropdown.style.display = 'none';
                resourceAutocompleteSelectedIndex = -1;
                saveTask();
                return;
            }

            // Get all resource names and filter by current word
            const allResources = getAllResourceNames();
            const matches = allResources.filter(name =>
                name.toLowerCase().includes(currentWord.toLowerCase())
            );

            if (matches.length === 0) {
                dropdown.style.display = 'none';
                resourceAutocompleteSelectedIndex = -1;
                saveTask();
                return;
            }

            // Build dropdown HTML
            dropdown.innerHTML = '';
            matches.forEach((name, index) => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.textContent = name;
                item.onclick = function() {
                    selectResource(name);
                };
                dropdown.appendChild(item);
            });

            dropdown.style.display = 'block';
            resourceAutocompleteSelectedIndex = -1;
            saveTask();
        }

        function handleResourceKeydown(event) {
            const dropdown = document.getElementById('resourceAutocomplete');
            if (dropdown.style.display !== 'block') return;

            const items = dropdown.querySelectorAll('.autocomplete-item');
            if (items.length === 0) return;

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                resourceAutocompleteSelectedIndex = Math.min(resourceAutocompleteSelectedIndex + 1, items.length - 1);
                updateResourceAutocompleteSelection(items);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                resourceAutocompleteSelectedIndex = Math.max(resourceAutocompleteSelectedIndex - 1, -1);
                updateResourceAutocompleteSelection(items);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (resourceAutocompleteSelectedIndex >= 0) {
                    const selectedItem = items[resourceAutocompleteSelectedIndex];
                    selectResource(selectedItem.textContent);
                }
            } else if (event.key === 'Escape') {
                dropdown.style.display = 'none';
                resourceAutocompleteSelectedIndex = -1;
            }
        }

        function updateResourceAutocompleteSelection(items) {
            items.forEach((item, index) => {
                if (index === resourceAutocompleteSelectedIndex) {
                    item.classList.add('selected');
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.classList.remove('selected');
                }
            });
        }

        function selectResource(name) {
            const input = document.getElementById('taskResources');
            const value = input.value;

            // Replace the current word being typed with the selected name
            const lastCommaIndex = value.lastIndexOf(',');
            let newValue;
            if (lastCommaIndex >= 0) {
                newValue = value.substring(0, lastCommaIndex + 1) + ' ' + name;
            } else {
                newValue = name;
            }

            input.value = newValue;
            const dropdown = document.getElementById('resourceAutocomplete');
            dropdown.style.display = 'none';
            resourceAutocompleteSelectedIndex = -1;
            input.focus();
            saveTask();
        }

        // Initialize event listeners after DOM is loaded
        document.addEventListener('DOMContentLoaded', function() {
            // Close modal when clicking overlay
            const overlay = document.getElementById('taskFormOverlay');
            if (overlay) {
                overlay.addEventListener('click', function(e) {
                    if (e.target === this) {
                        closeTaskForm();
                    }
                });
            }

            // Close modal when pressing Escape key
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    // First check if any autocomplete dropdown is open - close it instead
                    const depDropdown = document.getElementById('dependencyAutocomplete');
                    if (depDropdown && depDropdown.style.display === 'block') {
                        depDropdown.style.display = 'none';
                        autocompleteSelectedIndex = -1;
                        return;
                    }

                    const resDropdown = document.getElementById('resourceAutocomplete');
                    if (resDropdown && resDropdown.style.display === 'block') {
                        resDropdown.style.display = 'none';
                        resourceAutocompleteSelectedIndex = -1;
                        return;
                    }

                    // If no dropdown open, close the modal
                    const overlay = document.getElementById('taskFormOverlay');
                    if (overlay && overlay.classList.contains('active')) {
                        closeTaskForm();
                    }
                }
            });

            // Close autocomplete dropdowns when clicking outside
            document.addEventListener('click', function(e) {
                // Handle dependency autocomplete
                const depDropdown = document.getElementById('dependencyAutocomplete');
                const depInput = document.getElementById('taskDependencies');
                if (depDropdown && depInput && !depInput.contains(e.target) && !depDropdown.contains(e.target)) {
                    depDropdown.style.display = 'none';
                    autocompleteSelectedIndex = -1;
                }

                // Handle resource autocomplete
                const resDropdown = document.getElementById('resourceAutocomplete');
                const resInput = document.getElementById('taskResources');
                if (resDropdown && resInput && !resInput.contains(e.target) && !resDropdown.contains(e.target)) {
                    resDropdown.style.display = 'none';
                    resourceAutocompleteSelectedIndex = -1;
                }
            });

            // Add double-click handler to editor for opening task form
            const editor = document.getElementById('planEditor');
            if (editor) {
                editor.addEventListener('dblclick', function(e) {
                    const textarea = e.target;
                    const cursorPosition = textarea.selectionStart;
                    const textBeforeCursor = textarea.value.substring(0, cursorPosition);
                    const lineNumber = textBeforeCursor.split('\n').length;

                    // Get the line content
                    const lines = textarea.value.split('\n');
                    const line = lines[lineNumber - 1];

                    // Only open form for task lines (not empty lines, phase headers, or summary lines)
                    if (line && line.trim() && !line.includes('===') && !line.includes('---')) {
                        // Check if it looks like a task (has indentation or task markers)
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith('#')) {
                            openTaskForm(lineNumber);
                        }
                    }
                });
            }
        });
    </script>

    <!-- Task Form Modal -->
    <div id="taskFormOverlay" class="modal-overlay">
        <div class="task-form-modal">
            <div class="modal-header">
                <h2 id="taskFormTitle" contenteditable="true" style="flex: 1; outline: none; cursor: text;" oninput="updateTaskNameFromTitle()">Task Name</h2>
                <button class="close-btn" onclick="closeTaskForm()">&times;</button>
            </div>
            <div class="modal-body">
                <form onsubmit="event.preventDefault();">
                    <input type="hidden" id="taskName">

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div class="form-group">
                            <label for="taskDuration">Duration (days)</label>
                            <input type="number" id="taskDuration" placeholder="e.g., 5, 10" min="0" oninput="onDurationChange()">
                            <small>Edit duration or use dates below</small>
                        </div>

                        <div class="form-group">
                            <label>RAG Status</label>
                            <div id="ragDisplay" style="padding: 8px; border-radius: 4px; font-weight: bold; text-align: center; margin-bottom: 5px;">
                                -
                            </div>
                            <small id="ragReasoning" style="display: block; color: #666;">-</small>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div class="form-group">
                            <label for="taskStartDate">Start Date</label>
                            <input type="date" id="taskStartDate" class="form-control" onchange="onDateChange('start')">
                        </div>

                        <div class="form-group">
                            <label for="taskFinishDate">Finish Date</label>
                            <input type="date" id="taskFinishDate" class="form-control" onchange="onDateChange('finish')">
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="taskPercent">Completion %</label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <input type="number" id="taskPercent" min="0" max="100" placeholder="0-100"
                                   style="width: 80px; flex-shrink: 0;"
                                   oninput="saveTask(); updateRagDisplay(); updateProgressBar()">
                            <div class="progress" style="flex: 1; height: 25px;">
                                <div id="progressBar" class="progress-bar progress-bar-striped bg-success"
                                     role="progressbar" style="width: 0%; transition: width 0.3s ease;"
                                     aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                                    <span id="progressText"></span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div class="form-group">
                            <label for="taskResources">Resources</label>
                            <div class="autocomplete-container">
                                <input type="text" id="taskResources" placeholder="e.g., John, Alice"
                                       oninput="handleResourceInput()"
                                       onkeydown="handleResourceKeydown(event)"
                                       autocomplete="off">
                                <div id="resourceAutocomplete" class="autocomplete-dropdown"></div>
                            </div>
                            <small>Separate multiple resources with commas</small>
                        </div>

                        <div class="form-group">
                            <label for="taskDependencies">Dependencies</label>
                            <div class="autocomplete-container">
                                <input type="text" id="taskDependencies" placeholder="e.g., Task1, Task2"
                                       oninput="handleDependencyInput()"
                                       onkeydown="handleDependencyKeydown(event)"
                                       autocomplete="off">
                                <div id="dependencyAutocomplete" class="autocomplete-dropdown"></div>
                            </div>
                            <small>Task names this task depends on</small>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="taskComment">Comment</label>
                        <textarea id="taskComment" placeholder="Add notes or comments" oninput="saveTask()"
                                  style="background: white; color: black;"></textarea>
                    </div>

                    <div class="form-actions">
                        <button type="button" class="btn-primary" onclick="closeTaskForm()">Done</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

</body>
</html>
"""

@app.get("/")
async def index():
    """Serve the main HTML page."""
    return HTMLResponse(content=HTML_CONTENT)


@app.get("/favicon.png")
async def favicon():
    """Serve the favicon."""
    favicon_path = Path(__file__).parent / "favicon.png"
    if favicon_path.exists():
        return FileResponse(favicon_path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Favicon not found")


@app.get("/logo.png")
async def logo():
    """Serve the logo."""
    logo_path = Path(__file__).parent / "logo.png"
    if logo_path.exists():
        return FileResponse(logo_path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Logo not found")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.post("/render")
async def render_plan(data: RenderRequest):
    """Render a project plan and optionally export to Excel/PPT."""
    logger.info(f"Render request: exports={data.export_excel}, {data.export_ppt}")

    project_name = data.project_name or "Project"

    try:
        # Convert plan format (strip front matter)
        converted_content = convert_plan_format_to_standard(data.plan_text)

        # Check if we need exports
        has_exports = data.export_excel or data.export_ppt

        if has_exports:
            # Generate all files and return as ZIP
            zip_bytes = generate_exports(
                data.plan_text,
                converted_content,
                project_name,
                data.export_excel,
                data.export_ppt
            )

            logger.info(f"Successfully generated exports")

            return Response(
                content=zip_bytes,
                media_type="application/zip",
                headers={
                    "Content-Disposition": f'attachment; filename="{project_name}-exports.zip"'
                }
            )
        else:
            # Just return ASCII output
            ascii_output = text_to_markdown_table(
                converted_content,
                is_yaml=False,
                project_name=project_name,
                terminal_width=120,
                original_text=data.plan_text
            )

            return {"ascii_output": ascii_output}

    except Exception as e:
        logger.error(f"Error rendering plan: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to render plan: {str(e)}")


def generate_exports(
    original_text: str,
    converted_text: str,
    project_name: str,
    export_excel: bool,
    export_ppt: bool
) -> bytes:
    """Generate all requested exports and package them in a ZIP file."""

    # Create a ZIP file in memory
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # ASCII text output
        ascii_output = text_to_markdown_table(
            converted_text,
            is_yaml=False,
            project_name=project_name,
            terminal_width=120,
            original_text=original_text
        )
        zip_file.writestr(f"{project_name}.txt", ascii_output)

        # Excel export
        if export_excel:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name
            try:
                export_to_excel(
                    converted_text,
                    tmp_path,
                    is_yaml=False,
                    project_name=project_name,
                    original_text=original_text
                )
                with open(tmp_path, 'rb') as f:
                    zip_file.writestr(f"{project_name}.xlsx", f.read())
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        # PowerPoint timeline export
        if export_ppt:
            with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as tmp:
                tmp_path = tmp.name
            try:
                export_timeline_to_powerpoint(
                    converted_text,
                    tmp_path,
                    is_yaml=False,
                    project_name=project_name,
                    original_text=original_text
                )
                with open(tmp_path, 'rb') as f:
                    zip_file.writestr(f"{project_name}-timeline.pptx", f.read())
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

    # Get the ZIP file bytes
    zip_buffer.seek(0)
    return zip_buffer.read()


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8007))

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        reload=os.getenv("RELOAD", "false").lower() == "true"
    )

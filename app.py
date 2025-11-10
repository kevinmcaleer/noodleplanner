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


@app.get("/")
async def index():
    """Serve the main HTML page."""
    return HTMLResponse(content=r"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Noodle Planner - Project Planning Tool</title>

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
        }

        .editor-wrapper:focus-within {
            border-color: #667eea;
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
            background: #1e1e1e;
            color: #d4d4d4;
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
            <h1>🍜 Noodle Planner</h1>
            <p class="subtitle">Smart Project Planning & Scheduling Tool</p>
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
                        <div class="editor-wrapper">
                            <div class="line-numbers" id="lineNumbers">1</div>
                            <textarea id="planEditor" placeholder="Type or paste your project plan here...

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
                        <li><strong>Green:</strong> Task complete (100%) or not started yet</li>
                        <li><strong>Amber:</strong> Behind schedule (progress < expected)</li>
                        <li><strong>Red:</strong> Started but no progress (0% or missing)</li>
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

            if (!editor || !lineNumbers) {
                console.error('Editor or line numbers not found');
                return;
            }

            // Update line numbers
            function updateLineNumbers() {
                const content = editor.value || editor.placeholder || '';
                const lines = content.split('\\n');
                const lineCount = lines.length;

                let numbersText = '';
                for (let i = 1; i <= lineCount; i++) {
                    numbersText += i + '\\n';
                }

                lineNumbers.textContent = numbersText.trim();
            }

            // Sync scroll
            function syncScroll() {
                lineNumbers.scrollTop = editor.scrollTop;
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
            dropZone.innerHTML = `
                <div class="upload-icon">✓</div>
                <h3>${file.name}</h3>
                <p>Ready to render</p>
            `;

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
        let currentTaskLineNumber = null;

        function openTaskForm(lineNumber) {
            const editor = document.getElementById('planEditor');
            const lines = editor.value.split('\n');
            const taskLine = lines[lineNumber - 1];

            // Parse task details from line
            const task = parseTaskLine(taskLine, lineNumber);

            // Populate form
            document.getElementById('taskName').value = task.name || '';
            document.getElementById('taskFormTitle').textContent = task.name || 'Task Name';
            document.getElementById('taskDuration').value = task.duration || '';
            document.getElementById('taskStartDate').value = task.startDate || '';
            document.getElementById('taskFinishDate').value = task.finishDate || '';
            document.getElementById('taskPercent').value = task.percent || '';
            document.getElementById('taskResources').value = task.resources || '';
            document.getElementById('taskComment').value = task.comment || '';
            document.getElementById('taskDependencies').value = task.dependencies || '';

            currentTaskLineNumber = lineNumber;
            updateRagDisplay();
            updateProgressBar();
            document.getElementById('taskFormOverlay').classList.add('active');
        }

        function updateDatesAndDuration() {
            const startDate = document.getElementById('taskStartDate').value;
            const finishDate = document.getElementById('taskFinishDate').value;

            if (startDate && finishDate) {
                const start = new Date(startDate);
                const finish = new Date(finishDate);
                const diffTime = Math.abs(finish - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                document.getElementById('taskDuration').value = diffDays + 'd';
            } else {
                document.getElementById('taskDuration').value = '';
            }
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
                reasoning = 'Task not yet started';
            }
            // Red: Start date is in the past and no progress or 0%
            else if (startDateStr && new Date(startDateStr) <= today && percent === 0) {
                ragStatus = 'Red';
                bgColor = '#f44336';
                textColor = 'white';
                reasoning = 'Task started but no progress';
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
                    reasoning = `Behind schedule: ${percent}% complete, expected ${Math.round(expectedPercent)}%`;
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

            // Get form values
            const name = document.getElementById('taskName').value.trim();
            const duration = document.getElementById('taskDuration').value.trim();
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
            const indent = originalLine.match(/^\s*/)[0];
            let taskNamePart = dependsOnPrevious ? '*' + name : name;
            let newLine = indent + taskNamePart;

            if (duration) newLine += ' ' + duration;

            // Handle multiple resources - split by comma and add @ prefix to each
            if (resources) {
                const resourceList = resources.split(',').map(r => r.trim()).filter(r => r);
                resourceList.forEach(resource => {
                    newLine += ' @' + resource;
                });
            }

            if (percent) newLine += ' ' + percent + '%';
            if (comment) newLine += ' "' + comment + '"';
            // Only add #depends if there are dependencies other than the previous task
            if (nonPreviousDeps.length > 0) newLine += ' #' + nonPreviousDeps.join(',');

            // Update the line
            lines[currentTaskLineNumber - 1] = newLine;
            editor.value = lines.join('\n');

            // Update line numbers
            updateLineNumbers();
        }

        function getPreviousTaskName(lines, currentLineNum) {
            // Look backwards from current line to find the previous task
            for (let i = currentLineNum - 2; i >= 0; i--) {
                const line = lines[i].trim();
                // Skip empty lines, phase headers, and summary lines
                if (line && !line.includes('===') && !line.includes('---') && !line.startsWith('#')) {
                    // Extract task name (remove * prefix if present)
                    let taskName = line.replace(/^\*/, '').trim();

                    // Use same logic as parseTaskLine to extract just the task name
                    // Task name ends at first: digit+d (duration), @ (resource), # (dependency), % (percent), " (comment), Red/Amber/Green
                    const nameMatch = taskName.match(/^([^\d@#%"]+?)(?=\s+\d+d|\s+@|\s+#|\s+\d+%|\s+"|\s+Red|\s+Amber|\s+Green|$)/);
                    if (nameMatch) {
                        return nameMatch[1].trim();
                    } else {
                        // Fallback: just take everything before @ # % "
                        const fallbackMatch = taskName.match(/^([^@#%"]+)/);
                        if (fallbackMatch) {
                            return fallbackMatch[1].trim();
                        }
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

            // Remove leading whitespace and get the task text
            const trimmed = line.trim();
            if (!trimmed) return task;

            let remaining = trimmed;

            // Check for * prefix (depends on previous task)
            const hasStar = remaining.startsWith('*');
            if (hasStar) {
                remaining = remaining.substring(1).trim();
            }

            // Extract task name - everything before first duration, @, #, %, ", or RAG status
            // Task name ends at first: digit+d (duration), @ (resource), # (dependency), % (percent), " (comment), Red/Amber/Green
            const nameMatch = remaining.match(/^([^\d@#%"]+?)(?=\s+\d+d|\s+@|\s+#|\s+\d+%|\s+"|\s+Red|\s+Amber|\s+Green|$)/);
            if (nameMatch) {
                task.name = nameMatch[1].trim();
            } else {
                // Fallback: just take everything before @ # % "
                const fallbackMatch = remaining.match(/^([^@#%"]+)/);
                if (fallbackMatch) {
                    task.name = fallbackMatch[1].trim();
                }
            }

            // Extract duration (numbers followed by 'd')
            const durationMatch = remaining.match(/\b(\d+d)\b/);
            if (durationMatch) {
                task.duration = durationMatch[1];
            }

            // Extract percent (number followed by %)
            const percentMatch = remaining.match(/\b(\d+)%/);
            if (percentMatch) {
                task.percent = percentMatch[1];
            }

            // Extract ALL resources (all @ symbols) - handle multiple @resource entries
            const resourceMatches = remaining.match(/@([^\s@#%!"]+)/g);
            if (resourceMatches) {
                const resources = resourceMatches.map(r => r.substring(1)); // Remove @ prefix
                task.resources = resources.join(', ');
            }

            // Extract dependencies (after #)
            const depMatch = remaining.match(/#([^\s@%!"]+)/);
            const explicitDeps = depMatch ? depMatch[1].split(',').map(d => d.trim()) : [];

            // If task has * prefix, add previous task as dependency
            const editor = document.getElementById('planEditor');
            if (hasStar && editor) {
                const lines = editor.value.split('\n');
                const previousTaskName = getPreviousTaskName(lines, lineNum);
                if (previousTaskName) {
                    explicitDeps.unshift(previousTaskName);
                }
            }

            task.dependencies = explicitDeps.join(', ');

            // Extract comment (text in speech marks)
            const commentMatch = remaining.match(/"([^"]*)"/);
            if (commentMatch) {
                task.comment = commentMatch[1];
            }

            return task;
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
                            <label for="taskDuration">Duration</label>
                            <input type="text" id="taskDuration" placeholder="e.g., 5d, 10d" readonly style="background: #f0f0f0; cursor: not-allowed;">
                            <small>Auto-calculated from dates</small>
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
                            <input type="date" id="taskStartDate" onchange="updateDatesAndDuration(); saveTask(); updateRagDisplay()">
                        </div>

                        <div class="form-group">
                            <label for="taskFinishDate">Finish Date</label>
                            <input type="date" id="taskFinishDate" onchange="updateDatesAndDuration(); saveTask(); updateRagDisplay()">
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

                    <div class="form-group">
                        <label for="taskResources">Resources</label>
                        <input type="text" id="taskResources" placeholder="e.g., John, Alice" oninput="saveTask()">
                        <small>Separate multiple resources with commas</small>
                    </div>

                    <div class="form-group">
                        <label for="taskComment">Comment</label>
                        <textarea id="taskComment" placeholder="Add notes or comments" oninput="saveTask()"
                                  style="background: white; color: black;"></textarea>
                    </div>

                    <div class="form-group">
                        <label for="taskDependencies">Dependencies</label>
                        <input type="text" id="taskDependencies" placeholder="e.g., Task1, Task2" oninput="saveTask()">
                        <small>Task names this task depends on</small>
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
    """)


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

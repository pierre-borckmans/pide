package com.pide

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.vfs.VirtualFile
import java.io.File
import java.util.Timer
import kotlin.concurrent.schedule

@Service(Service.Level.APP)
class PiSelectionService : Disposable {
    private val selectionFile = File(System.getProperty("user.home"), ".pi/ide-selection.json")
    private var debounceTimer: java.util.TimerTask? = null
    private val timer = Timer()

    init {
        selectionFile.parentFile?.mkdirs()
    }

    fun sendSelection(file: VirtualFile?, selection: String?, startLine: Int?, endLine: Int?) {
        debounceTimer?.cancel()
        debounceTimer = timer.schedule(100) {
            writeSelection(file, selection, startLine, endLine)
        }
    }

    private fun writeSelection(file: VirtualFile?, selection: String?, startLine: Int?, endLine: Int?) {
        try {
            if (file == null) {
                selectionFile.delete()
                return
            }

            val json = buildString {
                append("{\n")
                append("  \"file\": \"${escapeJson(file.path)}\",\n")
                append("  \"ide\": \"${getIdeName()}\",\n")
                append("  \"timestamp\": ${System.currentTimeMillis()}")
                if (!selection.isNullOrEmpty()) {
                    append(",\n  \"selection\": \"${escapeJson(selection)}\"")
                    startLine?.let { append(",\n  \"startLine\": $it") }
                    endLine?.let { append(",\n  \"endLine\": $it") }
                }
                append("\n}")
            }

            selectionFile.writeText(json)
        } catch (e: Exception) {
            // Ignore write errors
        }
    }

    private fun escapeJson(s: String): String {
        return s.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }

    private fun getIdeName(): String {
        val appName = ApplicationInfo.getInstance().fullApplicationName.lowercase()
        return when {
            "goland" in appName -> "goland"
            "intellij" in appName -> "intellij"
            "webstorm" in appName -> "webstorm"
            "pycharm" in appName -> "pycharm"
            "rider" in appName -> "rider"
            "clion" in appName -> "clion"
            "rubymine" in appName -> "rubymine"
            "phpstorm" in appName -> "phpstorm"
            "android" in appName -> "android-studio"
            "datagrip" in appName -> "datagrip"
            else -> "jetbrains"
        }
    }

    override fun dispose() {
        debounceTimer?.cancel()
        timer.cancel()
    }

    companion object {
        fun getInstance(): PiSelectionService =
            ApplicationManager.getApplication().getService(PiSelectionService::class.java)
    }
}

class PiStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        val service = PiSelectionService.getInstance()

        // Listen for new editors
        EditorFactory.getInstance().addEditorFactoryListener(object : EditorFactoryListener {
            override fun editorCreated(event: EditorFactoryEvent) {
                addSelectionListener(event.editor, service)
            }
        }, service)

        // Add listener to existing editors
        EditorFactory.getInstance().allEditors.forEach { editor ->
            addSelectionListener(editor, service)
        }
    }

    private fun addSelectionListener(editor: Editor, service: PiSelectionService) {
        editor.selectionModel.addSelectionListener(object : SelectionListener {
            override fun selectionChanged(e: SelectionEvent) {
                val document = e.editor.document
                val file = FileDocumentManager.getInstance().getFile(document)
                val selection = e.editor.selectionModel

                if (selection.hasSelection()) {
                    val startLine = document.getLineNumber(selection.selectionStart) + 1
                    val endLine = document.getLineNumber(selection.selectionEnd) + 1
                    service.sendSelection(file, selection.selectedText, startLine, endLine)
                } else {
                    service.sendSelection(file, null, null, null)
                }
            }
        })
    }
}

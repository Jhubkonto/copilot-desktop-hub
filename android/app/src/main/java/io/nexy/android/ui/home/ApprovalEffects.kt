package io.nexy.android.ui.home

import android.content.Context
import io.nexy.android.NexyApp
import io.nexy.android.data.model.WsEvent
import io.nexy.android.notification.ApprovalNotificationManager

interface ApprovalEffects {
    fun showApproval(request: WsEvent.ToolApprovalRequest)
    fun vibrateDecision(approved: Boolean)
    fun cancelApproval()
}

class AndroidApprovalEffects(private val context: Context) : ApprovalEffects {
    override fun showApproval(request: WsEvent.ToolApprovalRequest) {
        if (NexyApp.isInForeground) return
        ApprovalNotificationManager.show(context, request.requestId, request.toolName)
    }

    override fun vibrateDecision(approved: Boolean) {
        ApprovalNotificationManager.vibrateDecision(context, approved)
    }

    override fun cancelApproval() {
        ApprovalNotificationManager.cancel(context)
    }
}

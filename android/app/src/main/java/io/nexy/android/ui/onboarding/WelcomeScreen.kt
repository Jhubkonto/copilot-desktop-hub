package io.nexy.android.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

@Composable
fun WelcomeScreen(
    onPairDesktop: () -> Unit,
    onUseStandalone: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Surface(
            color = Color(0xFF1F2937),
            shape = RoundedCornerShape(10.dp),
        ) {
            Text(
                text = buildAnnotatedString {
                    withStyle(SpanStyle(color = Color(0xFFA78BFA))) { append("N") }
                    withStyle(SpanStyle(color = Color.White)) { append("exy") }
                },
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
                fontSize = 30.sp,
                fontWeight = FontWeight.Bold,
                fontStyle = FontStyle.Italic,
            )
        }

        Text("Welcome to Nexy", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(
            "Choose how you want to get started. You can change this later from Settings.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        SetupChoice(
            icon = NexyIconName.Scan,
            title = "Connect to your desktop",
            detail = "Scan the QR code in Nexy Desktop → Settings → Mobile to sync chats, projects, agents, and approvals.",
        )
        NexyPrimaryButton(
            text = "Pair with desktop",
            onClick = onPairDesktop,
            modifier = Modifier.fillMaxWidth(),
            leadingNexyIcon = NexyIconName.Scan,
        )

        SetupChoice(
            icon = NexyIconName.Settings,
            title = "Use the app on this phone",
            detail = "Continue in standalone mode, then add an API key in Settings → Providers when you are ready to chat.",
        )
        NexySecondaryButton(
            text = "Continue standalone",
            onClick = onUseStandalone,
            modifier = Modifier.fillMaxWidth(),
            leadingNexyIcon = NexyIconName.Settings,
        )

        Spacer(Modifier.height(4.dp))
        Text(
            "You can pair later from the connection button in the app.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SetupChoice(icon: NexyIconName, title: String, detail: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        NexyIcon(icon, contentDescription = null, modifier = Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

package io.nexy.android.ui.splash

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SplashScreen(onFinished: () -> Unit) {
    val alpha = remember { Animatable(0f) }
    val scale = remember { Animatable(0.88f) }

    LaunchedEffect(Unit) {
        launch { alpha.animateTo(1f, tween(400, easing = FastOutSlowInEasing)) }
        launch { scale.animateTo(1f, tween(400, easing = FastOutSlowInEasing)) }
        delay(800)
        alpha.animateTo(0f, tween(300, easing = FastOutSlowInEasing))
        onFinished()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier.graphicsLayer(
                alpha = alpha.value,
                scaleX = scale.value,
                scaleY = scale.value,
            ),
        ) {
            Text(
                text = buildAnnotatedString {
                    withStyle(SpanStyle(color = Color(0xFFA78BFA))) { append("N") }
                    withStyle(SpanStyle(color = Color.White)) { append("exy") }
                },
                style = TextStyle(
                    fontSize = 52.sp,
                    fontWeight = FontWeight.Bold,
                    fontStyle = FontStyle.Italic,
                ),
            )
        }
    }
}

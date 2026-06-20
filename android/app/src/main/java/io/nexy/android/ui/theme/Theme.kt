package io.nexy.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

data class NexyExtendedColors(val success: Color, val onSuccess: Color)

val LocalNexyColors = staticCompositionLocalOf {
    NexyExtendedColors(success = Green500, onSuccess = Color.White)
}

private val DarkColorScheme = darkColorScheme(
    primary = Blue500,
    onPrimary = Color.White,
    primaryContainer = Blue700,
    onPrimaryContainer = Blue200,
    secondary = Gray400,
    onSecondary = Gray900,
    secondaryContainer = Gray700,
    onSecondaryContainer = Gray200,
    tertiary = Gray400,
    onTertiary = Gray900,
    tertiaryContainer = Gray700,
    onTertiaryContainer = Gray200,
    background = Gray900,
    onBackground = Gray100,
    surface = Gray800,
    onSurface = Gray100,
    surfaceVariant = Gray700,
    onSurfaceVariant = Gray400,
    surfaceContainer = Gray800,
    surfaceContainerHigh = Gray700,
    surfaceContainerHighest = Gray600,
    outline = Gray600,
    outlineVariant = Gray700,
    error = Red400,
    onError = Gray900,
    errorContainer = Color(0xFF7F1D1D),
    onErrorContainer = Red400,
    inverseSurface = Gray100,
    inverseOnSurface = Gray900,
    inversePrimary = Blue700,
    scrim = Color.Black,
)

private val LightColorScheme = lightColorScheme(
    primary = Blue500,
    onPrimary = Color.White,
    primaryContainer = Blue100,
    onPrimaryContainer = Blue900,
    secondary = Gray500,
    onSecondary = Color.White,
    secondaryContainer = Gray100,
    onSecondaryContainer = Gray800,
    tertiary = Gray500,
    onTertiary = Color.White,
    tertiaryContainer = Gray100,
    onTertiaryContainer = Gray800,
    background = Gray50,
    onBackground = Gray900,
    surface = Color.White,
    onSurface = Gray800,
    surfaceVariant = Gray100,
    onSurfaceVariant = Gray500,
    surfaceContainer = Gray100,
    surfaceContainerHigh = Gray200,
    surfaceContainerHighest = Gray200,
    outline = Gray300,
    outlineVariant = Gray200,
    error = Red600,
    onError = Color.White,
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Red600,
    inverseSurface = Gray800,
    inverseOnSurface = Gray100,
    inversePrimary = Blue400,
    scrim = Color.Black,
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

@Composable
fun NexyTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val extendedColors = if (darkTheme) {
        NexyExtendedColors(success = Green500, onSuccess = Color.White)
    } else {
        NexyExtendedColors(success = Green700, onSuccess = Color.White)
    }

    CompositionLocalProvider(LocalNexyColors provides extendedColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            shapes = AppShapes,
            content = content,
        )
    }
}

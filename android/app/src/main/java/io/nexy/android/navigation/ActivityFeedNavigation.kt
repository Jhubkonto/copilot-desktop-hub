package io.nexy.android.navigation

import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

internal const val ACTIVITY_FEED_ROUTE = "activity-feed"
internal const val PINNED_CHATS_ROUTE = "pinned-chats"
internal const val NEW_CONTENT_ROUTE = "new-content"

/**
 * Opens the activity feed as a single branch in the navigation tree.
 *
 * If the feed is already below the current screen, this returns to that existing entry instead
 * of adding another feed to the back stack.
 */
internal fun NavHostController.openActivityFeed() {
    if (currentDestination?.route == ACTIVITY_FEED_ROUTE) return
    if (popBackStack(ACTIVITY_FEED_ROUTE, inclusive = false)) return

    navigate(ACTIVITY_FEED_ROUTE) {
        launchSingleTop = true
    }
}

internal fun NavHostController.openPinnedChats() {
    if (currentDestination?.route == PINNED_CHATS_ROUTE) return
    if (popBackStack(PINNED_CHATS_ROUTE, inclusive = false)) return

    navigate(PINNED_CHATS_ROUTE) {
        launchSingleTop = true
    }
}

internal fun NavHostController.openNewContent() {
    if (currentDestination?.route == NEW_CONTENT_ROUTE) return
    if (popBackStack(NEW_CONTENT_ROUTE, inclusive = false)) return
    navigate(NEW_CONTENT_ROUTE) { launchSingleTop = true }
}

/**
 * Opens an item from the activity feed without creating a feed -> screen -> feed -> screen loop.
 *
 * Tapping the screen that is already directly beneath the feed just closes the feed. A different
 * target remains a child of the one feed entry, and [openActivityFeed] returns to that same entry
 * if the edge tab is tapped again.
 */
internal fun NavHostController.openActivityRoute(route: String) {
    val underlyingEntry = previousBackStackEntry
    if (
        currentDestination?.route == ACTIVITY_FEED_ROUTE &&
        underlyingEntry?.matchesConcreteRoute(route) == true
    ) {
        popBackStack()
        return
    }

    navigate(route) {
        launchSingleTop = true
    }
}

/** Opens a chat from the pinned shelf while keeping one reusable shelf entry in the stack. */
internal fun NavHostController.openPinnedChat(route: String) {
    val underlyingEntry = previousBackStackEntry
    if (
        currentDestination?.route == PINNED_CHATS_ROUTE &&
        underlyingEntry?.matchesConcreteRoute(route) == true
    ) {
        popBackStack()
        return
    }

    navigate(route) {
        launchSingleTop = true
    }
}

private fun NavBackStackEntry.matchesConcreteRoute(route: String): Boolean =
    routeTargetsSameScreen(
        destinationPattern = destination.route,
        argumentValue = { name -> arguments?.getString(name) },
        targetRoute = route,
    )

/**
 * Compares a concrete route such as `chat/123` with a destination pattern and its resolved args.
 * Query parameters omitted by the concrete route are optional and therefore do not prevent a
 * match (for example, activity routes omit Chat's optional agentId/projectId parameters).
 */
internal fun routeTargetsSameScreen(
    destinationPattern: String?,
    argumentValue: (String) -> String?,
    targetRoute: String,
): Boolean {
    if (destinationPattern == null) return false

    val patternPath = destinationPattern.substringBefore('?').trim('/')
    val targetPath = targetRoute.substringBefore('?').trim('/')
    val patternSegments = patternPath.split('/').filter { it.isNotEmpty() }
    val targetSegments = targetPath.split('/').filter { it.isNotEmpty() }
    if (patternSegments.size != targetSegments.size) return false

    return patternSegments.zip(targetSegments).all { (patternSegment, targetSegment) ->
        val argumentName = patternSegment
            .takeIf { it.startsWith('{') && it.endsWith('}') }
            ?.substring(1, patternSegment.length - 1)

        if (argumentName == null) {
            patternSegment == targetSegment
        } else {
            argumentValue(argumentName) == decodeRouteSegment(targetSegment)
        }
    }
}

private fun decodeRouteSegment(value: String): String =
    URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8.name())

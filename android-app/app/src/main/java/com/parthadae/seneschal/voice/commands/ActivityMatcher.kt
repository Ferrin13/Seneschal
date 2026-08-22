package com.parthadae.seneschal.voice.commands

import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.domain.Activity
import com.parthadae.seneschal.voice.VoiceCommandResult
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.max
import kotlin.math.min

/**
 * Fuzzy-matches a spoken activity name against the user's active activities.
 * Speech recognition mangles names ("Reading" -> "reading", "redding"), so
 * exact matching isn't enough; we score by exact/prefix/contains/token
 * overlap and fall back to edit distance.
 */
@Singleton
class ActivityMatcher @Inject constructor(
    private val activityRepository: ActivityRepository,
) {
    sealed interface Match {
        data class Found(val activity: Activity) : Match
        data class Ambiguous(val candidates: List<Activity>) : Match
        data object None : Match
    }

    suspend fun match(spokenName: String): Match {
        val query = normalize(spokenName)
        if (query.isBlank()) return Match.None
        val candidates = activityRepository.activities.first().filter { !it.isArchived }

        var bestScore = 0
        val best = mutableListOf<Activity>()
        for (activity in candidates) {
            val s = score(query, normalize(activity.name))
            if (s > bestScore) {
                bestScore = s
                best.clear()
                best.add(activity)
            } else if (s == bestScore && s > 0) {
                best.add(activity)
            }
        }
        return when {
            best.isEmpty() -> Match.None
            best.size == 1 -> Match.Found(best.single())
            else -> Match.Ambiguous(best.take(3))
        }
    }

    private fun normalize(s: String): String =
        s.lowercase().replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim()

    private fun score(query: String, name: String): Int {
        if (name == query) return 100
        if (name.startsWith(query) || query.startsWith(name)) return 70
        if (name.contains(query) || query.contains(name)) return 60
        val queryTokens = query.split(' ').toSet()
        val nameTokens = name.split(' ').toSet()
        if (nameTokens.containsAll(queryTokens) || queryTokens.containsAll(nameTokens)) return 50
        val dist = levenshtein(query, name)
        if (dist <= max(1, min(query.length, name.length) / 4)) return 40 - dist
        return 0
    }

    private fun levenshtein(a: String, b: String): Int {
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        var curr = IntArray(b.length + 1)
        for (i in 1..a.length) {
            curr[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                curr[j] = min(min(curr[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost)
            }
            val tmp = prev
            prev = curr
            curr = tmp
        }
        return prev[b.length]
    }
}

/**
 * Standard spoken error for a non-[ActivityMatcher.Match.Found] result, or
 * null when the match succeeded. Keeps the "unknown activity" wording
 * consistent across handlers.
 */
fun ActivityMatcher.Match.errorOrNull(spokenName: String): VoiceCommandResult.Failure? = when (this) {
    is ActivityMatcher.Match.Found -> null
    is ActivityMatcher.Match.None ->
        VoiceCommandResult.Failure("I couldn't find an activity called \"$spokenName\".")
    is ActivityMatcher.Match.Ambiguous ->
        VoiceCommandResult.Failure(
            "Did you mean " + candidates.joinToString(" or ") { it.name } + "? Try again with the full name."
        )
}

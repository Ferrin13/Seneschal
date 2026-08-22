package com.parthadae.seneschal.voice.tools

import com.parthadae.seneschal.data.remote.dto.VoiceToolDefDto
import javax.inject.Inject
import javax.inject.Singleton

/** All client tools from every registered [VoiceToolPack]. */
@Singleton
class VoiceToolRegistry @Inject constructor(
    packs: Set<@JvmSuppressWildcards VoiceToolPack>,
) {
    val tools: List<VoiceTool> = packs.flatMap { it.tools }.sortedBy { it.name }

    private val byName: Map<String, VoiceTool> = tools.associateBy { it.name }

    init {
        check(byName.size == tools.size) {
            "Duplicate voice tool names across packs: " +
                tools.groupBy { it.name }.filterValues { it.size > 1 }.keys
        }
    }

    fun byName(name: String): VoiceTool? = byName[name]

    /** Wire-format catalog sent with every /voice/command request. */
    fun catalog(): List<VoiceToolDefDto> = tools.map {
        VoiceToolDefDto(
            name = it.name,
            description = it.description,
            parameters = it.parameters,
            requiresConfirmation = it.requiresConfirmation,
        )
    }
}

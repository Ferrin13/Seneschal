package com.parthadae.seneschal.di

import com.parthadae.seneschal.voice.VoiceCommandHandler
import com.parthadae.seneschal.voice.commands.HelpVoiceHandler
import com.parthadae.seneschal.voice.commands.RemoteVoiceHandler
import com.parthadae.seneschal.voice.commands.SlotLogVoiceHandler
import com.parthadae.seneschal.voice.commands.TimeQueryVoiceHandler
import com.parthadae.seneschal.voice.commands.TimerVoiceHandler
import com.parthadae.seneschal.voice.tools.TimeTrackingToolPack
import com.parthadae.seneschal.voice.tools.VoiceToolPack
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet

/**
 * Registry of voice capabilities. Every feature that gains voice support
 * adds bindings here — mirrors how SyncModule collects OutboxHandlers.
 *
 * - [VoiceToolPack]: schema'd tools for the server-side LLM loop (primary
 *   online path).
 * - [VoiceCommandHandler]: regex fast-path handlers for the offline
 *   recognizer path.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class VoiceModule {
    @Binds
    @IntoSet
    abstract fun bindTimeTrackingToolPack(impl: TimeTrackingToolPack): VoiceToolPack

    @Binds
    @IntoSet
    abstract fun bindTimerVoiceHandler(impl: TimerVoiceHandler): VoiceCommandHandler

    @Binds
    @IntoSet
    abstract fun bindSlotLogVoiceHandler(impl: SlotLogVoiceHandler): VoiceCommandHandler

    @Binds
    @IntoSet
    abstract fun bindTimeQueryVoiceHandler(impl: TimeQueryVoiceHandler): VoiceCommandHandler

    @Binds
    @IntoSet
    abstract fun bindHelpVoiceHandler(impl: HelpVoiceHandler): VoiceCommandHandler

    @Binds
    @IntoSet
    abstract fun bindRemoteVoiceHandler(impl: RemoteVoiceHandler): VoiceCommandHandler
}

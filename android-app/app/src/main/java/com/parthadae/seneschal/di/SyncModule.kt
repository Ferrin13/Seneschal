package com.parthadae.seneschal.di

import com.parthadae.seneschal.data.repository.ExpenseRepository
import com.parthadae.seneschal.sync.BusinessPuller
import com.parthadae.seneschal.sync.CategoryActivityPuller
import com.parthadae.seneschal.sync.ExpensePuller
import com.parthadae.seneschal.sync.ExpenseUpsertOutboxHandler
import com.parthadae.seneschal.sync.ImageAttacher
import com.parthadae.seneschal.sync.ImageUploadOutboxHandler
import com.parthadae.seneschal.sync.OutboxHandler
import com.parthadae.seneschal.sync.Puller
import com.parthadae.seneschal.sync.SlotPuller
import com.parthadae.seneschal.sync.SlotUpsertOutboxHandler
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet

/**
 * Multibindings for the generic sync layer. Adding a new outbox kind or
 * pull source is a matter of writing a new `@Singleton` implementation
 * and binding it here.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class SyncModule {
    @Binds
    @IntoSet
    abstract fun bindSlotUpsertHandler(impl: SlotUpsertOutboxHandler): OutboxHandler

    @Binds
    @IntoSet
    abstract fun bindExpenseUpsertHandler(impl: ExpenseUpsertOutboxHandler): OutboxHandler

    @Binds
    @IntoSet
    abstract fun bindImageUploadHandler(impl: ImageUploadOutboxHandler): OutboxHandler

    @Binds
    @IntoSet
    abstract fun bindCategoryActivityPuller(impl: CategoryActivityPuller): Puller

    @Binds
    @IntoSet
    abstract fun bindSlotPuller(impl: SlotPuller): Puller

    @Binds
    @IntoSet
    abstract fun bindBusinessPuller(impl: BusinessPuller): Puller

    @Binds
    @IntoSet
    abstract fun bindExpensePuller(impl: ExpensePuller): Puller

    @Binds
    @IntoSet
    abstract fun bindExpenseImageAttacher(impl: ExpenseRepository): ImageAttacher
}

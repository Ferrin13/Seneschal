package com.parthadae.seneschal.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * v3 -> v4: adds the group-texting tables. The `message_templates` table is
 * intentionally NOT created here while that sub-feature is temporarily
 * disabled; re-enable it with its own statements (and bump the version) when
 * templates come back.
 *
 * The CREATE statements must match Room's generated schema exactly (column
 * types, foreign keys, and `index_<table>_<column>` index names) or Room's
 * post-migration validation will throw on open.
 */
val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `groups` (" +
                "`id` TEXT NOT NULL, " +
                "`name` TEXT NOT NULL, " +
                "`createdAt` INTEGER NOT NULL, " +
                "`updatedAt` INTEGER NOT NULL, " +
                "`clientUpdatedAt` INTEGER NOT NULL, " +
                "`deletedAt` INTEGER, " +
                "PRIMARY KEY(`id`))"
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_groups_updatedAt` ON `groups` (`updatedAt`)"
        )

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `group_members` (" +
                "`id` TEXT NOT NULL, " +
                "`groupId` TEXT NOT NULL, " +
                "`displayName` TEXT NOT NULL, " +
                "`phoneNumber` TEXT NOT NULL, " +
                "`contactLookupKey` TEXT, " +
                "`createdAt` INTEGER NOT NULL, " +
                "`updatedAt` INTEGER NOT NULL, " +
                "`clientUpdatedAt` INTEGER NOT NULL, " +
                "`deletedAt` INTEGER, " +
                "PRIMARY KEY(`id`), " +
                "FOREIGN KEY(`groupId`) REFERENCES `groups`(`id`) " +
                "ON UPDATE NO ACTION ON DELETE NO ACTION)"
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_group_members_groupId` " +
                "ON `group_members` (`groupId`)"
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_group_members_updatedAt` " +
                "ON `group_members` (`updatedAt`)"
        )
    }
}

/**
 * v4 -> v5: drops the now-disabled `message_templates` table.
 *
 * The bump is required because an earlier build shipped a *different* v4
 * schema (one that still declared `message_templates`). Re-declaring the
 * disabled schema under the same version number trips Room's identity-hash
 * check on existing v4 installs. Going to v5 lets Room run this migration and
 * re-stamp the identity hash. The DROP is also safe (and a no-op) on v4
 * databases that never created the table — e.g. ones arriving via
 * [MIGRATION_3_4], which doesn't create it.
 */
val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("DROP TABLE IF EXISTS `message_templates`")
    }
}

/**
 * v5 -> v6: recreates the `message_templates` table dropped by
 * [MIGRATION_4_5] now that the group-texting templates feature is back.
 *
 * Matches Room's generated schema for `MessageTemplateEntity` exactly
 * (column types + `index_message_templates_updatedAt`) so the
 * post-migration validation passes. `IF NOT EXISTS` keeps it safe on the
 * off chance a database still carries the table.
 */
val MIGRATION_5_6 = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `message_templates` (" +
                "`id` TEXT NOT NULL, " +
                "`title` TEXT NOT NULL, " +
                "`body` TEXT NOT NULL, " +
                "`createdAt` INTEGER NOT NULL, " +
                "`updatedAt` INTEGER NOT NULL, " +
                "`clientUpdatedAt` INTEGER NOT NULL, " +
                "`deletedAt` INTEGER, " +
                "PRIMARY KEY(`id`))"
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_message_templates_updatedAt` " +
                "ON `message_templates` (`updatedAt`)"
        )
    }
}

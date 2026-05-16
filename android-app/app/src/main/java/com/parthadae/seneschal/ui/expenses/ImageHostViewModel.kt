package com.parthadae.seneschal.ui.expenses

import androidx.lifecycle.ViewModel
import com.parthadae.seneschal.data.repository.ImageRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * Trivial ViewModel that exposes [ImageRepository] to composables that
 * only need to resolve presigned display URLs (e.g. list/detail thumbnails).
 * Hilt's `hiltViewModel<ImageHostViewModel>()` is the cleanest way to grab
 * a singleton dependency from an arbitrary composable without plumbing it
 * through every parent.
 */
@HiltViewModel
class ImageHostViewModel @Inject constructor(
    val imageRepository: ImageRepository,
) : ViewModel()

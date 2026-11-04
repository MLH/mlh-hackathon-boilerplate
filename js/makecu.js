(function () {
  var countdown = document.querySelector("[data-countdown]");

  if (countdown) {
    var target = new Date(countdown.getAttribute("data-countdown"));
    var fields = {
      days: countdown.querySelector('[data-countdown-value="days"]'),
      hours: countdown.querySelector('[data-countdown-value="hours"]'),
      minutes: countdown.querySelector('[data-countdown-value="minutes"]'),
      seconds: countdown.querySelector('[data-countdown-value="seconds"]')
    };

    var pad = function (value, size) {
      return String(value).padStart(size, "0");
    };

    var renderCountdown = function () {
      var distance = target.getTime() - Date.now();

      if (Number.isNaN(target.getTime())) {
        return;
      }

      if (distance <= 0) {
        fields.days.textContent = "000";
        fields.hours.textContent = "00";
        fields.minutes.textContent = "00";
        fields.seconds.textContent = "00";
        return;
      }

      var seconds = Math.floor(distance / 1000);
      var days = Math.floor(seconds / 86400);
      var hours = Math.floor((seconds % 86400) / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      var remainingSeconds = seconds % 60;

      fields.days.textContent = pad(days, 3);
      fields.hours.textContent = pad(hours, 2);
      fields.minutes.textContent = pad(minutes, 2);
      fields.seconds.textContent = pad(remainingSeconds, 2);
    };

    renderCountdown();
    window.setInterval(renderCountdown, 1000);
  }

  var checklistItems = Array.prototype.slice.call(document.querySelectorAll("[data-checklist-item]"));

  if (checklistItems.length) {
    var checklistMeter = document.querySelector(".checklist-meter");
    var checklistPercent = checklistMeter ? checklistMeter.querySelector("[data-checklist-percent]") : null;
    var checklistSummary = checklistMeter ? checklistMeter.querySelector("[data-checklist-summary]") : null;
    var checklistRequiredBar = checklistMeter ? checklistMeter.querySelector("[data-checklist-bar-required]") : null;
    var checklistOptionalBar = checklistMeter ? checklistMeter.querySelector("[data-checklist-bar-optional]") : null;
    var checklistRequiredItems = checklistItems.filter(function (item) {
      return item.hasAttribute("data-checklist-required");
    });
    var checklistOptionalItems = checklistItems.filter(function (item) {
      return item.hasAttribute("data-checklist-optional");
    });
    var checklistCards = Array.prototype.slice.call(document.querySelectorAll(".checklist-card"));
    var checklistCompleteDialog = document.querySelector("[data-checklist-complete-dialog]");
    var checklistDialogMark = checklistCompleteDialog
      ? checklistCompleteDialog.querySelector("[data-checklist-dialog-mark]")
      : null;
    var checklistDialogPrompt = checklistCompleteDialog
      ? checklistCompleteDialog.querySelector("[data-checklist-dialog-prompt]")
      : null;
    var checklistDialogTitle = checklistCompleteDialog
      ? checklistCompleteDialog.querySelector("[data-checklist-dialog-title]")
      : null;
    var checklistDialogMessage = checklistCompleteDialog
      ? checklistCompleteDialog.querySelector("[data-checklist-dialog-message]")
      : null;
    var checklistRequiredShown = false;
    var checklistAllShown = false;
    var checklistCompletionTimer = null;
    var checklistScheduledMilestone = null;
    var checklistInteractionsReady = false;
    var storagePrefix = "makecu-checklist:" + window.location.pathname + ":";

    var setStoredValue = function (key, value) {
      try {
        window.localStorage.setItem(key, value ? "1" : "0");
      } catch (error) {
        return;
      }
    };

    var getStoredValue = function (key) {
      try {
        return window.localStorage.getItem(key);
      } catch (error) {
        return null;
      }
    };

    var showChecklistDialog = function (milestone) {
      var isAllComplete = milestone === "all";

      if (checklistDialogMark) {
        checklistDialogMark.textContent = isAllComplete ? "10/10" : "READY";
      }

      if (checklistDialogPrompt) {
        checklistDialogPrompt.textContent = isAllComplete ? "$ ./overachiever_mode.sh" : "$ ./ready_to_hack.sh";
      }

      if (checklistDialogTitle) {
        checklistDialogTitle.textContent = isAllComplete
          ? "WOW! You've done everything?"
          : "You're ready for the hackathon.";
      }

      if (checklistDialogMessage) {
        checklistDialogMessage.textContent = isAllComplete
          ? "What kind of project are you cooking up?!"
          : "All 3 mandatory items are complete. Please complete prerequisite trainings for any and all other machines you may wish to utilize.";
      }

      if (typeof checklistCompleteDialog.showModal === "function") {
        checklistCompleteDialog.showModal();
      } else {
        checklistCompleteDialog.setAttribute("open", "");
      }
    };

    var scheduleChecklistDialog = function (milestone) {
      if (checklistCompletionTimer) {
        window.clearTimeout(checklistCompletionTimer);
      }

      checklistScheduledMilestone = milestone;
      checklistCompletionTimer = window.setTimeout(function () {
        var requiredComplete = checklistRequiredItems.every(function (item) {
          return item.checked;
        });
        var allComplete = checklistItems.every(function (item) {
          return item.checked;
        });
        var shouldShow = milestone === "all" ? allComplete : requiredComplete && !allComplete;

        if (shouldShow) {
          showChecklistDialog(milestone);
        }

        checklistCompletionTimer = null;
        checklistScheduledMilestone = null;
      }, 900);
    };

    var updateChecklistProgress = function () {
      var completed = checklistItems.filter(function (item) {
        return item.checked;
      }).length;
      var requiredCompleted = checklistRequiredItems.filter(function (item) {
        return item.checked;
      }).length;
      var optionalCompleted = checklistOptionalItems.filter(function (item) {
        return item.checked;
      }).length;
      var percent = Math.round((completed / checklistItems.length) * 100);
      var requiredPercent = (requiredCompleted / checklistItems.length) * 100;
      var optionalPercent = (optionalCompleted / checklistItems.length) * 100;
      var requiredComplete = requiredCompleted === checklistRequiredItems.length;
      var allComplete = completed === checklistItems.length;

      if (checklistPercent) {
        checklistPercent.textContent = percent + "%";
        checklistPercent.setAttribute("data-text", percent + "%");
        checklistPercent.setAttribute("aria-label", percent + "%");
      }

      if (checklistSummary) {
        checklistSummary.textContent =
          requiredCompleted +
          "/" +
          checklistRequiredItems.length +
          " mandatory · " +
          optionalCompleted +
          "/" +
          checklistOptionalItems.length +
          " optional";
      }

      if (checklistRequiredBar) {
        checklistRequiredBar.style.width = requiredPercent + "%";
      }

      if (checklistOptionalBar) {
        checklistOptionalBar.style.width = optionalPercent + "%";
      }

      checklistCards.forEach(function (card) {
        var cardItems = Array.prototype.slice.call(card.querySelectorAll("[data-checklist-item]"));
        var cardCompleted = cardItems.filter(function (item) {
          return item.checked;
        }).length;
        var cardCounter = card.querySelector(".checklist-card-header span");

        if (cardCounter) {
          cardCounter.textContent = cardCompleted + "/" + cardItems.length;
        }
      });

      if (checklistInteractionsReady && allComplete && !checklistAllShown && checklistCompleteDialog) {
        checklistAllShown = true;
        checklistRequiredShown = true;
        scheduleChecklistDialog("all");
      } else if (
        checklistInteractionsReady &&
        requiredComplete &&
        !checklistRequiredShown &&
        checklistCompleteDialog
      ) {
        checklistRequiredShown = true;
        scheduleChecklistDialog("required");
      } else if (
        checklistCompletionTimer &&
        ((checklistScheduledMilestone === "all" && !allComplete) ||
          (checklistScheduledMilestone === "required" && (!requiredComplete || allComplete)))
      ) {
        window.clearTimeout(checklistCompletionTimer);
        checklistCompletionTimer = null;
        checklistScheduledMilestone = null;
      }

      if (!requiredComplete) {
        checklistRequiredShown = false;
        checklistAllShown = false;
      } else if (!allComplete) {
        checklistAllShown = false;
      }
    };

    checklistItems.forEach(function (item) {
      var key = storagePrefix + item.id;
      var savedValue = getStoredValue(key);
      var row = item.closest("li");

      if (savedValue === "1") {
        item.checked = true;
      }

      if (row) {
        row.classList.toggle("is-complete", item.checked);
      }

      item.addEventListener("change", function () {
        setStoredValue(key, item.checked);

        if (row) {
          row.classList.toggle("is-complete", item.checked);
        }

        updateChecklistProgress();
      });
    });

    updateChecklistProgress();
    checklistInteractionsReady = true;
  }

  document.querySelectorAll("[data-dialog-target]").forEach(function (trigger) {
    var dialog = document.getElementById(trigger.getAttribute("data-dialog-target"));

    if (!dialog) {
      return;
    }

    trigger.addEventListener("click", function () {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    });
  });

  document.querySelectorAll("[data-dialog-close]").forEach(function (button) {
    button.addEventListener("click", function () {
      var dialog = button.closest("dialog");

      if (dialog) {
        dialog.close();
      }
    });
  });

  document.querySelectorAll(".judge-dialog, .team-dialog, .checklist-complete-dialog").forEach(function (dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  });

  var trackSelector = document.querySelector("[data-track-selector]");

  if (trackSelector) {
    var trackCharacters = Array.prototype.slice.call(trackSelector.querySelectorAll(".track-selector-character"));
    var trackImages = trackCharacters.map(function (character) {
      return character.querySelector("img");
    });
    var trackDots = Array.prototype.slice.call(trackSelector.querySelectorAll(".track-selector-dot"));
    var trackName = trackSelector.querySelector("[data-track-selector-name]");
    var trackPanel = trackSelector.querySelector("[data-track-selector-info]");
    var trackPanelIcon = trackPanel ? trackPanel.querySelector(".track-selector-info-icon img") : null;
    var trackPanelHeading = trackPanel ? trackPanel.querySelector("h3") : null;
    var trackPanelCopy = trackPanel ? trackPanel.querySelector("p") : null;
    var trackWheel = trackSelector.querySelector("[data-track-selector-wheel]");
    var trackData = trackCharacters.map(function (character) {
      return {
        name: character.getAttribute("data-track-name"),
        title: character.getAttribute("data-track-title"),
        description: character.getAttribute("data-track-description"),
        icon: character.getAttribute("data-track-icon"),
        iconAlt: character.getAttribute("data-track-icon-alt"),
        still: character.getAttribute("data-track-still-src"),
        selected: character.getAttribute("data-track-selected-src")
      };
    });
    var trackStepAngle = 120;
    var trackRotation = 120;
    var activeTrack = 2;
    var trackPanelTimer = null;
    var trackAnimationFrame = null;
    var trackDragging = false;
    var trackDragPointer = null;
    var trackLastX = 0;
    var trackLastTime = 0;
    var trackDragVelocity = 0;
    var trackDragDistance = 0;
    var suppressTrackClickUntil = 0;
    var reducedTrackMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    var normalizedTrackIndex = function (index) {
      return ((index % trackData.length) + trackData.length) % trackData.length;
    };

    var nearestTrackIndex = function () {
      return normalizedTrackIndex(-Math.round(trackRotation / trackStepAngle));
    };

    var updateTrackSelection = function (next, animatePanel) {
      var selected;

      if (typeof animatePanel === "undefined") {
        animatePanel = true;
      }

      next = normalizedTrackIndex(next);

      if (next === activeTrack) {
        return;
      }

      activeTrack = next;
      selected = trackData[activeTrack];

      trackCharacters.forEach(function (character, index) {
        var nextSource = index === activeTrack && trackData[index].selected
          ? trackData[index].selected
          : trackData[index].still;

        character.setAttribute("aria-pressed", String(index === activeTrack));

        if (trackImages[index].getAttribute("src") !== nextSource) {
          trackImages[index].setAttribute("src", nextSource);
        }
      });

      trackDots.forEach(function (dot, index) {
        dot.setAttribute("aria-pressed", String(index === activeTrack));
      });

      trackName.textContent = selected.name;
      window.clearTimeout(trackPanelTimer);
      trackPanel.classList.remove("is-fading-in");

      var updateTrackPanel = function () {
        trackPanel.classList.remove("track-selector-info-0", "track-selector-info-1", "track-selector-info-2");
        trackPanel.classList.add("track-selector-info-" + activeTrack);
        trackPanelIcon.setAttribute("src", selected.icon);
        trackPanelIcon.setAttribute("alt", selected.iconAlt);
        trackPanelHeading.textContent = selected.title;
        trackPanelCopy.textContent = selected.description;
      };

      if (!animatePanel || reducedTrackMotion.matches) {
        trackPanel.classList.remove("is-fading-out");
        updateTrackPanel();
        return;
      }

      trackPanel.classList.add("is-fading-out");
      trackPanelTimer = window.setTimeout(function () {
        updateTrackPanel();
        trackPanel.classList.remove("is-fading-out");
        void trackPanel.offsetWidth;
        trackPanel.classList.add("is-fading-in");
      }, 190);
    };

    var drawTrackWheel = function () {
      var wheelWidth = trackWheel.getBoundingClientRect().width;
      var radius = Math.min(wheelWidth * 0.35, 315);
      var nextActiveTrack = nearestTrackIndex();

      trackCharacters.forEach(function (character, index) {
        var radians = (index * trackStepAngle + trackRotation) * Math.PI / 180;
        var depth = (Math.cos(radians) + 1) / 2;
        var x = Math.sin(radians) * radius;
        var y = -56 * (1 - depth);
        var frontWeight = Math.max(0, Math.min(1, (depth - 0.55) / 0.45));
        var frontScaleAdjustment = index === 0 ? 0.05 : (index === 1 ? -0.05 : 0);
        var scale = (0.61 + (0.44 * depth)) * (1 + (frontScaleAdjustment * frontWeight));
        var brightness = 0.72 + (0.34 * depth);
        var saturation = 0.78 + (0.27 * depth);

        character.style.transform = "translateX(calc(-50% + " + x + "px)) translateY(" + (y + 12) + "px) translateZ(" + ((depth - 0.5) * 220) + "px) scale(" + scale + ")";
        character.style.filter = "brightness(" + brightness + ") saturate(" + saturation + ") drop-shadow(0 13px 15px rgba(0, 0, 0, 0.24))";
        character.style.zIndex = String(Math.round(depth * 100) + 2);
        character.setAttribute("data-track-position", index === nextActiveTrack ? "active" : (x < 0 ? "left" : "right"));
      });

      updateTrackSelection(nextActiveTrack);
    };

    var stopTrackMotion = function () {
      if (trackAnimationFrame !== null) {
        window.cancelAnimationFrame(trackAnimationFrame);
      }

      trackAnimationFrame = null;
    };

    var animateTrackRotation = function (target, duration) {
      var start;
      var distance;
      var startedAt;

      if (typeof duration === "undefined") {
        duration = 520;
      }

      stopTrackMotion();

      start = trackRotation;
      distance = target - start;
      startedAt = performance.now();

      var frame = function (now) {
        var progress = Math.min(1, (now - startedAt) / duration);
        var eased = 1 - Math.pow(1 - progress, 4);

        trackRotation = start + (distance * eased);
        drawTrackWheel();

        if (progress < 1) {
          trackAnimationFrame = window.requestAnimationFrame(frame);
        } else {
          trackRotation = target;
          drawTrackWheel();
          trackAnimationFrame = null;
        }
      };

      trackAnimationFrame = window.requestAnimationFrame(frame);
    };

    var targetTrackRotation = function (index) {
      var base = -normalizedTrackIndex(index) * trackStepAngle;
      return base + (Math.round((trackRotation - base) / 360) * 360);
    };

    var spinToTrack = function (index) {
      animateTrackRotation(targetTrackRotation(index));
    };

    var snapTrackWheel = function () {
      animateTrackRotation(Math.round(trackRotation / trackStepAngle) * trackStepAngle, 520);
    };

    var startTrackInertia = function (velocity) {
      var currentVelocity = Math.max(-1.75, Math.min(1.75, velocity * 1.35));
      var previousTime = performance.now();

      stopTrackMotion();

      var coast = function (now) {
        var elapsed = Math.min(32, now - previousTime);

        previousTime = now;
        trackRotation += currentVelocity * elapsed;
        currentVelocity *= Math.pow(0.96, elapsed / 16);
        drawTrackWheel();

        if (Math.abs(currentVelocity) > 0.009) {
          trackAnimationFrame = window.requestAnimationFrame(coast);
        } else {
          trackAnimationFrame = null;
          snapTrackWheel();
        }
      };

      if (Math.abs(currentVelocity) < 0.025) {
        snapTrackWheel();
      } else {
        trackAnimationFrame = window.requestAnimationFrame(coast);
      }
    };

    trackCharacters.forEach(function (character) {
      character.addEventListener("click", function () {
        if (Date.now() < suppressTrackClickUntil) {
          return;
        }

        spinToTrack(Number(character.getAttribute("data-track-index")));
      });
    });

    trackDots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        spinToTrack(Number(dot.getAttribute("data-track-index")));
      });
    });

    var beginTrackDrag = function (clientX, pointerId) {
      stopTrackMotion();
      trackDragging = true;
      trackDragPointer = pointerId;
      trackLastX = clientX;
      trackLastTime = performance.now();
      trackDragVelocity = 0;
      trackDragDistance = 0;
      trackWheel.classList.add("is-dragging");
    };

    var moveTrackDrag = function (clientX) {
      var now;
      var deltaX;
      var elapsed;
      var degrees;

      if (!trackDragging) {
        return;
      }

      now = performance.now();
      deltaX = clientX - trackLastX;
      elapsed = Math.max(8, now - trackLastTime);
      degrees = deltaX * 0.42;
      trackRotation += degrees;
      trackDragDistance += Math.abs(deltaX);
      trackDragVelocity = (trackDragVelocity * 0.66) + ((degrees / elapsed) * 0.34);
      trackLastX = clientX;
      trackLastTime = now;
      drawTrackWheel();
    };

    var finishTrackDrag = function () {
      if (!trackDragging) {
        return;
      }

      trackDragging = false;
      trackWheel.classList.remove("is-dragging");

      if (trackDragDistance > 8) {
        suppressTrackClickUntil = Date.now() + 280;
      }

      startTrackInertia(trackDragVelocity);
      trackDragPointer = null;
    };

    if (window.PointerEvent) {
      trackWheel.addEventListener("pointerdown", function (event) {
        beginTrackDrag(event.clientX, event.pointerId);
        trackWheel.setPointerCapture(event.pointerId);
      });

      trackWheel.addEventListener("pointermove", function (event) {
        if (event.pointerId === trackDragPointer) {
          moveTrackDrag(event.clientX);
        }
      });

      var finishPointerTrackDrag = function (event) {
        if (!trackDragging || event.pointerId !== trackDragPointer) {
          return;
        }

        if (trackWheel.hasPointerCapture(event.pointerId)) {
          trackWheel.releasePointerCapture(event.pointerId);
        }

        finishTrackDrag();
      };

      trackWheel.addEventListener("pointerup", finishPointerTrackDrag);
      trackWheel.addEventListener("pointercancel", finishPointerTrackDrag);
    } else {
      trackWheel.addEventListener("mousedown", function (event) {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        beginTrackDrag(event.clientX, "mouse");
      });

      window.addEventListener("mousemove", function (event) {
        if (trackDragPointer === "mouse") {
          moveTrackDrag(event.clientX);
        }
      });

      window.addEventListener("mouseup", function () {
        if (trackDragPointer === "mouse") {
          finishTrackDrag();
        }
      });
    }

    trackSelector.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        spinToTrack(activeTrack + (event.key === "ArrowRight" ? 1 : -1));
      }
    });

    window.addEventListener("resize", drawTrackWheel);
    drawTrackWheel();
  }

  var sponsorProductCarousels = Array.prototype.slice.call(document.querySelectorAll("[data-sponsor-product-carousel]"));

  sponsorProductCarousels.forEach(function (carousel) {
    var slides = Array.prototype.slice.call(carousel.querySelectorAll(".sponsor-product-slide"));
    var brand = carousel.closest(".sponsor-brand");
    var names = brand ? Array.prototype.slice.call(brand.querySelectorAll(".sponsor-product-name-slide")) : [];
    var activeIndex = 0;

    if (slides.length < 2) {
      return;
    }

    window.setInterval(function () {
      var previousIndex = activeIndex;
      activeIndex = (activeIndex + 1) % slides.length;

      [slides, names].forEach(function (items) {
        var previous = items[previousIndex];
        var current = items[activeIndex];

        if (!previous || !current) {
          return;
        }

        previous.classList.remove("is-current");
        previous.classList.add("is-leaving");
        previous.setAttribute("aria-hidden", "true");
        current.classList.remove("is-leaving");
        current.classList.add("is-current");
        current.removeAttribute("aria-hidden");

        window.setTimeout(function () {
          previous.classList.remove("is-leaving");
        }, 620);
      });
    }, 3600);
  });

  var sponsorCards = Array.prototype.slice.call(document.querySelectorAll("[data-sponsor-details]"));

  if (sponsorCards.length) {
    var desktopSponsorMedia = window.matchMedia("(min-width: 721px)");

    var closeSponsorCard = function (card) {
      var trigger = card.querySelector(".sponsor-logo-trigger");
      var details = card.querySelector(".sponsor-details");

      card.classList.remove("is-active", "is-pinned");

      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }

      if (details) {
        details.setAttribute("aria-hidden", "true");
      }
    };

    var openSponsorCard = function (card) {
      var trigger = card.querySelector(".sponsor-logo-trigger");
      var details = card.querySelector(".sponsor-details");

      sponsorCards.forEach(function (otherCard) {
        if (otherCard !== card) {
          closeSponsorCard(otherCard);
        }
      });

      if (details) {
        details.style.setProperty("--sponsor-details-height", details.scrollHeight + "px");
      }

      card.classList.add("is-active");

      if (trigger) {
        trigger.setAttribute("aria-expanded", "true");
      }

      if (details) {
        details.setAttribute("aria-hidden", "false");
      }
    };

    sponsorCards.forEach(function (card) {
      var trigger = card.querySelector(".sponsor-logo-trigger");

      card.addEventListener("mouseleave", function () {
        if (desktopSponsorMedia.matches) {
          closeSponsorCard(card);
        }
      });

      card.addEventListener("focusin", function () {
        openSponsorCard(card);
      });

      card.addEventListener("focusout", function () {
        window.setTimeout(function () {
          if (!card.contains(document.activeElement) && !card.classList.contains("is-pinned")) {
            closeSponsorCard(card);
          }
        }, 0);
      });

      if (trigger) {
        trigger.addEventListener("mouseenter", function () {
          if (desktopSponsorMedia.matches) {
            openSponsorCard(card);
          }
        });

        trigger.addEventListener("click", function () {
          if (desktopSponsorMedia.matches) {
            openSponsorCard(card);
            return;
          }

          if (card.classList.contains("is-pinned")) {
            closeSponsorCard(card);
            return;
          }

          openSponsorCard(card);
          card.classList.add("is-pinned");
        });
      }
    });

    desktopSponsorMedia.addEventListener("change", function () {
      sponsorCards.forEach(closeSponsorCard);
    });

    window.addEventListener("resize", function () {
      sponsorCards.forEach(function (card) {
        var details = card.querySelector(".sponsor-details");

        if (details && card.classList.contains("is-active")) {
          details.style.setProperty("--sponsor-details-height", details.scrollHeight + "px");
        }
      });
    });

    document.addEventListener("click", function (event) {
      sponsorCards.forEach(function (card) {
        if (!card.contains(event.target)) {
          closeSponsorCard(card);
        }
      });
    });
  }

  var glitchTitle = document.querySelector(".glitch-title");

  if (glitchTitle) {
    var glitchBase = glitchTitle.querySelector(".glitch-base");
    var glitchIcons = ["health", "leaf", "bulb"];
    var glitchIndex = 0;
    var glitchDuration = 1350;
    var glitchTimeout;

    if (glitchBase && !glitchTitle.querySelector(".glitch-slice")) {
      ["top", "bottom"].forEach(function (sliceName) {
        var glitchSlice = glitchBase.cloneNode(true);
        glitchSlice.classList.remove("glitch-base");
        glitchSlice.classList.add("glitch-slice", "glitch-slice-" + sliceName);
        glitchSlice.setAttribute("aria-hidden", "true");
        glitchTitle.appendChild(glitchSlice);
      });
    }

    var triggerTitleGlitch = function () {
      window.clearTimeout(glitchTimeout);
      glitchTitle.classList.remove("is-glitching");
      glitchTitle.setAttribute("data-glitch-icon", glitchIcons[glitchIndex % glitchIcons.length]);
      void glitchTitle.offsetWidth;
      glitchTitle.classList.add("is-glitching");
      glitchIndex += 1;

      glitchTimeout = window.setTimeout(function () {
        glitchTitle.classList.remove("is-glitching");
        glitchTitle.removeAttribute("data-glitch-icon");
      }, glitchDuration);
    };

    window.setInterval(triggerTitleGlitch, 10000);
  }
})();

//! Route history commands to the editor that actually has native focus.
//! WebKit's undo manager does not contain programmatic CM / Monaco edits.

use objc2::{sel, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSView, NSWindow};
use tauri::{Emitter, Manager};

fn native_history(command: &str) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let selector = if command == "undo" {
        sel!(undo:)
    } else {
        sel!(redo:)
    };
    // External browser views and native dialogs keep their original responder chain.
    unsafe {
        NSApplication::sharedApplication(mtm).sendAction_to_from(selector, None, None);
    }
}

pub(crate) fn dispatch_history(app: &tauri::AppHandle, command: &'static str) {
    // windows(), not webview_windows(): adding a browser child makes main cease
    // to be a WebviewWindow, even while that child is hidden.
    let Some(window) = app
        .windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
    else {
        native_history(command);
        return;
    };
    let Some(webview) = app.get_webview(window.label()) else {
        native_history(command);
        return;
    };
    let target = webview.clone();
    if let Err(error) = webview.with_webview(move |platform| {
        // SAFETY: Tauri supplies live WKWebView / NSWindow handles on the main
        // thread. WKWebView inherits NSView; the borrow stays inside this call.
        let native_view = unsafe { &*platform.inner().cast::<NSView>() };
        let native_window = unsafe { &*platform.ns_window().cast::<NSWindow>() };
        let owns_focus = native_window.isKeyWindow()
            && native_window
                .firstResponder()
                .and_then(|responder| responder.downcast::<NSView>().ok())
                .is_some_and(|responder| responder.isDescendantOf(native_view));
        if owns_focus {
            // with_webview holds Wry's dispatcher mutex. emit_to calls eval,
            // which needs that same mutex: defer until this callback returns.
            // The native main queue preserves Undo/Redo order; worker tasks do not.
            dispatch2::DispatchQueue::main().exec_async(move || {
                if let Err(error) = target.emit_to(
                    tauri::EventTarget::Webview {
                        label: target.label().to_owned(),
                    },
                    "window:history-command",
                    command,
                ) {
                    crate::ulog_error!("[EditMenu] Failed to dispatch {command}: {error}");
                }
            });
        } else {
            native_history(command);
        }
    }) {
        crate::ulog_error!("[EditMenu] Failed to access focused webview: {error}");
    }
}

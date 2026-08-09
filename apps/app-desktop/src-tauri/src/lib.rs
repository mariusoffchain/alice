use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use zeroize::{Zeroize, Zeroizing};

pub struct LocalAIState(pub Mutex<Option<CommandChild>>);
pub struct ChatStorageKeyState(pub Mutex<Option<Zeroizing<[u8; 32]>>>);

const CHAT_KEYRING_SERVICE: &str = "com.alicebitcoin.desktop";
const CHAT_KEYRING_USER: &str = "chat-storage-v1";
const CHAT_VALUE_VERSION: &str = "v1:";
const MAX_CHAT_PLAINTEXT_BYTES: usize = 16 * 1024 * 1024;

fn validate_chat_storage_context(context: &str) -> Result<(), String> {
    if context == "alice_chat_sessions"
        || context == "alice_pedagogical_profile_v2"
        || context == "alice_learning_profile_v3"
        || context == "alice_personal_memory_v1"
        || context.starts_with("alice_chat_session_")
    {
        Ok(())
    } else {
        Err("Invalid chat storage context".into())
    }
}

fn load_or_create_chat_storage_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(CHAT_KEYRING_SERVICE, CHAT_KEYRING_USER)
        .map_err(|e| format!("Failed to open the system keychain: {e}"))?;
    match entry.get_password() {
        Ok(encoded) => {
            let mut decoded = STANDARD_NO_PAD.decode(encoded).map_err(|_| {
                "The chat encryption key stored in the system keychain is invalid.".to_string()
            })?;
            if decoded.len() != 32 {
                decoded.zeroize();
                return Err(
                    "The chat encryption key stored in the system keychain has an invalid length."
                        .into(),
                );
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&decoded);
            decoded.zeroize();
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            let encoded = STANDARD_NO_PAD.encode(key);
            if let Err(error) = entry.set_password(&encoded) {
                key.zeroize();
                return Err(format!(
                    "Failed to save the chat encryption key in the system keychain: {error}"
                ));
            }
            Ok(key)
        }
        Err(error) => Err(format!(
            "Failed to read the chat encryption key from the system keychain: {error}"
        )),
    }
}

fn encrypt_chat_value_with_key(
    key: &[u8; 32],
    plaintext: &str,
    context: &str,
) -> Result<String, String> {
    validate_chat_storage_context(context)?;
    if plaintext.len() > MAX_CHAT_PLAINTEXT_BYTES {
        return Err("Conversation data is too large to encrypt.".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Failed to initialize chat encryption.".to_string())?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext.as_bytes(),
                aad: context.as_bytes(),
            },
        )
        .map_err(|_| "Failed to encrypt conversation data.".to_string())?;
    let mut payload = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(format!(
        "{CHAT_VALUE_VERSION}{}",
        STANDARD_NO_PAD.encode(payload)
    ))
}

fn decrypt_chat_value_with_key(
    key: &[u8; 32],
    encrypted: &str,
    context: &str,
) -> Result<String, String> {
    validate_chat_storage_context(context)?;
    let payload = encrypted
        .strip_prefix(CHAT_VALUE_VERSION)
        .ok_or_else(|| "Unsupported chat encryption format.".to_string())?;
    let mut decoded = STANDARD_NO_PAD
        .decode(payload)
        .map_err(|_| "Conversation data is corrupt.".to_string())?;
    if decoded.len() <= 12 {
        decoded.zeroize();
        return Err("Conversation data is corrupt.".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Failed to initialize chat decryption.".to_string())?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&decoded[..12]),
            Payload {
                msg: &decoded[12..],
                aad: context.as_bytes(),
            },
        )
        .map_err(|_| "Conversation data could not be authenticated.".to_string())?;
    decoded.zeroize();
    String::from_utf8(plaintext).map_err(|_| "Conversation data is not valid text.".into())
}

#[tauri::command]
fn chat_storage_encrypt(
    plaintext: String,
    context: String,
    state: tauri::State<'_, ChatStorageKeyState>,
) -> Result<String, String> {
    with_chat_storage_key(&state, |key| {
        encrypt_chat_value_with_key(key, &plaintext, &context)
    })
}

#[tauri::command]
fn chat_storage_decrypt(
    ciphertext: String,
    context: String,
    state: tauri::State<'_, ChatStorageKeyState>,
) -> Result<String, String> {
    with_chat_storage_key(&state, |key| {
        decrypt_chat_value_with_key(key, &ciphertext, &context)
    })
}

fn with_chat_storage_key<T>(
    state: &tauri::State<'_, ChatStorageKeyState>,
    operation: impl FnOnce(&[u8; 32]) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Chat encryption key state is unavailable.".to_string())?;
    if guard.is_none() {
        *guard = Some(Zeroizing::new(load_or_create_chat_storage_key()?));
    }
    let key = guard
        .as_ref()
        .ok_or_else(|| "Chat encryption key is unavailable.".to_string())?;
    operation(key)
}

fn validate_model_filename(filename: &str) -> Result<(), String> {
    let is_safe = filename.ends_with(".gguf")
        && !filename.contains('/')
        && !filename.contains('\\')
        && !filename.contains("..");
    if is_safe {
        Ok(())
    } else {
        Err("Invalid model filename".into())
    }
}

fn desktop_models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models directory: {e}"))?;
    Ok(dir)
}

fn desktop_model_path(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    validate_model_filename(filename)?;
    Ok(desktop_models_dir(app)?.join(filename))
}

fn desktop_model_temp_path(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    validate_model_filename(filename)?;
    Ok(desktop_models_dir(app)?.join(format!("{filename}.download")))
}

fn resolve_llama_server() -> &'static str {
    const CANDIDATES: &[&str] = &[
        "/opt/homebrew/bin/llama-server",
        "/usr/local/bin/llama-server",
    ];
    for path in CANDIDATES {
        if std::path::Path::new(path).exists() {
            return path;
        }
    }
    "llama-server"
}

#[tauri::command]
fn local_ai_start(
    model_path: String,
    state: tauri::State<'_, LocalAIState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
    let binary = resolve_llama_server();
    let (_rx, child) = app
        .shell()
        .command(binary)
        .args([
            "--model",
            &model_path,
            "--port",
            "11435",
            "--ctx-size",
            "4096",
            "--log-disable",
        ])
        .spawn()
        .map_err(|e| format!("Failed to start llama-server ({binary}): {e}"))?;
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
fn local_ai_stop(state: tauri::State<'_, LocalAIState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to stop llama-server: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn local_ai_is_running(state: tauri::State<'_, LocalAIState>) -> bool {
    state.0.lock().map(|g| g.is_some()).unwrap_or(false)
}

#[tauri::command]
fn local_ai_model_status(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let installed_path = desktop_model_path(&app, &filename)?;
    if installed_path.exists() {
        return Ok("installed".into());
    }

    Ok("not-installed".into())
}

#[tauri::command]
fn local_ai_model_path(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let installed_path = desktop_model_path(&app, &filename)?;
    if installed_path.exists() {
        return Ok(installed_path.to_string_lossy().into_owned());
    }

    Err("Model is not installed".into())
}

#[tauri::command]
fn local_ai_download_model_prepare(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let temp = desktop_model_temp_path(&app, &filename)?;
    let _ = std::fs::remove_file(&temp);
    std::fs::File::create(&temp)
        .map_err(|e| format!("Failed to create model download file: {e}"))?;
    Ok(())
}

#[tauri::command]
fn local_ai_download_model_chunk(
    app: tauri::AppHandle,
    filename: String,
    chunk: Vec<u8>,
) -> Result<(), String> {
    use std::io::Write;
    let temp = desktop_model_temp_path(&app, &filename)?;
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&temp)
        .map_err(|e| format!("Failed to open model download file: {e}"))?;
    file.write_all(&chunk)
        .map_err(|e| format!("Failed to write model download chunk: {e}"))?;
    Ok(())
}

#[tauri::command]
fn local_ai_download_model_finish(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let temp = desktop_model_temp_path(&app, &filename)?;
    let dest = desktop_model_path(&app, &filename)?;
    std::fs::rename(&temp, &dest).map_err(|e| format!("Failed to finalize model download: {e}"))?;
    Ok(())
}

#[tauri::command]
fn local_ai_delete_model(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let path = desktop_model_path(&app, &filename)?;
    let temp = desktop_model_temp_path(&app, &filename)?;
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(temp);

    Ok(())
}

// On macOS 15+, WebKit silently drops fetch() calls from tauri:// pages to ipc://.
// No JS error fires, so ipc-protocol.js's customProtocolIpcFailed flag stays false
// and the window.ipc.postMessage fallback never activates.
// Wrapping window.fetch with a 100ms timeout forces a rejection on the first hung
// ipc:// call, which sets customProtocolIpcFailed = true and switches all subsequent
// invokes to the postMessage path permanently.
const IPC_FETCH_TIMEOUT_FIX: &str = r#"
;(function () {
  var _f = window.fetch;
  window.fetch = function (resource, init) {
    var url = typeof resource === 'string' ? resource : resource && resource.url;
    if (url && url.indexOf('ipc://') === 0) {
      return Promise.race([
        _f.call(window, resource, init),
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('ipc:// unavailable')); }, 100);
        })
      ]);
    }
    return _f.apply(window, arguments);
  };
})();
"#;

// Menu ids are forwarded to the web layer as an `alice-menu` DOM event rather
// than handled in Rust: New Chat, Settings and Search all live in the React
// sidebar, which owns the session state.
const MENU_NEW_CHAT: &str = "new-chat";
const MENU_SEARCH: &str = "search";
const MENU_SETTINGS: &str = "settings";

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let settings = MenuItemBuilder::with_id(MENU_SETTINGS, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let new_chat = MenuItemBuilder::with_id(MENU_NEW_CHAT, "New Chat")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let search = MenuItemBuilder::with_id(MENU_SEARCH, "Search Conversations")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;

    let about_metadata = AboutMetadata {
        name: Some("Alice".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        ..Default::default()
    };

    let alice_menu = SubmenuBuilder::new(app, "Alice")
        .about(Some(about_metadata))
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_chat)
        .item(&search)
        .separator()
        .close_window()
        .build()?;

    // Setting a custom menu replaces the macOS default one, so Edit has to be
    // rebuilt by hand or copy/paste stops working in the composer.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .fullscreen()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&alice_menu, &file_menu, &edit_menu, &window_menu])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .append_invoke_initialization_script(IPC_FETCH_TIMEOUT_FIX)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let menu = build_app_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id != MENU_NEW_CHAT && id != MENU_SEARCH && id != MENU_SETTINGS {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                // A menu accelerator is swallowed by macOS and never reaches the
                // webview, so the keyboard shortcuts have to be replayed here.
                let _ = window.eval(&format!(
                    "window.dispatchEvent(new CustomEvent('alice-menu', {{ detail: '{id}' }}))"
                ));
            }
        })
        .manage(LocalAIState(Mutex::new(None)))
        .manage(ChatStorageKeyState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            chat_storage_decrypt,
            chat_storage_encrypt,
            local_ai_delete_model,
            local_ai_download_model_chunk,
            local_ai_download_model_finish,
            local_ai_download_model_prepare,
            local_ai_model_path,
            local_ai_model_status,
            local_ai_start,
            local_ai_stop,
            local_ai_is_running,
        ])
        .build(tauri::generate_context!())
        .expect("error building application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<LocalAIState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

#[cfg(test)]
mod chat_storage_tests {
    use super::{
        decrypt_chat_value_with_key, encrypt_chat_value_with_key, load_or_create_chat_storage_key,
    };
    use zeroize::Zeroize;

    #[test]
    fn chat_storage_round_trips_without_plaintext_in_the_envelope() {
        let key = [7u8; 32];
        let context = "alice_chat_session_test";
        let plaintext = r#"[{"role":"user","content":"private conversation"}]"#;
        let encrypted = encrypt_chat_value_with_key(&key, plaintext, context).unwrap();

        assert!(!encrypted.contains("private conversation"));
        assert_eq!(
            decrypt_chat_value_with_key(&key, &encrypted, context).unwrap(),
            plaintext
        );
    }

    #[test]
    fn learning_profile_uses_the_same_keychain_backed_envelope() {
        let key = [5u8; 32];
        let plaintext = r#"{"version":3,"concepts":{}}"#;
        let encrypted = encrypt_chat_value_with_key(&key, plaintext, "alice_learning_profile_v3").unwrap();

        assert!(!encrypted.contains("concepts"));
        assert_eq!(
            decrypt_chat_value_with_key(&key, &encrypted, "alice_learning_profile_v3").unwrap(),
            plaintext
        );

        let memory = r#"{"version":1,"enabled":true,"items":[]}"#;
        let encrypted_memory = encrypt_chat_value_with_key(&key, memory, "alice_personal_memory_v1").unwrap();
        assert!(!encrypted_memory.contains("items"));
        assert_eq!(
            decrypt_chat_value_with_key(&key, &encrypted_memory, "alice_personal_memory_v1").unwrap(),
            memory
        );
    }

    #[test]
    fn chat_storage_rejects_tampering_and_wrong_context() {
        let key = [9u8; 32];
        let encrypted =
            encrypt_chat_value_with_key(&key, "sensitive title", "alice_chat_sessions").unwrap();
        assert!(
            decrypt_chat_value_with_key(&key, &encrypted, "alice_chat_session_other",).is_err()
        );

        let mut tampered = encrypted.into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'A' { b'B' } else { b'A' };
        let tampered = String::from_utf8(tampered).unwrap();

        assert!(decrypt_chat_value_with_key(&key, &tampered, "alice_chat_sessions").is_err());
    }

    #[test]
    #[ignore = "writes Alice Desktop's persistent key to the operating-system keychain"]
    fn chat_storage_keychain_persists_the_same_key() {
        let mut first = load_or_create_chat_storage_key().unwrap();
        let mut second = load_or_create_chat_storage_key().unwrap();

        assert_eq!(first, second);
        first.zeroize();
        second.zeroize();
    }
}

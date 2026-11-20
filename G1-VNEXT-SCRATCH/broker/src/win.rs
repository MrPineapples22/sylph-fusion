#![allow(non_snake_case, dead_code)]

use std::ffi::{c_void, OsStr};
use std::io::{self, Read};
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::OnceLock;

#[cfg(feature = "synthetic-maintenance")]
#[path = "synthetic_maintenance.rs"]
mod synthetic_maintenance;

type BOOL = i32;
type DWORD = u32;
type HANDLE = *mut c_void;
type SID_NAME_USE = u32;
type LPSERVICE_MAIN_FUNCTIONW = Option<unsafe extern "system" fn(DWORD, *mut *mut u16)>;
type LPHANDLER_FUNCTION_EX =
    Option<unsafe extern "system" fn(DWORD, DWORD, *mut c_void, *mut c_void) -> DWORD>;

#[repr(C)]
#[derive(Clone, Copy)]
struct LUID {
    LowPart: DWORD,
    HighPart: i32,
}

struct TokenPrivilege {
    name: String,
    attributes: DWORD,
}

struct ProcessIdentity {
    user_sid: String,
    integrity_rid: DWORD,
    privilege_count: DWORD,
    enabled_privilege_count: DWORD,
    privileges: Vec<TokenPrivilege>,
}

const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;
const ERROR_INSUFFICIENT_BUFFER: DWORD = 122;
const ERROR_FILE_NOT_FOUND: DWORD = 2;
const ERROR_PIPE_LISTENING: DWORD = 536;
const ERROR_PIPE_CONNECTED: DWORD = 535;
const ERROR_MORE_DATA: DWORD = 234;
const ERROR_NO_DATA: DWORD = 232;
const ERROR_PIPE_NOT_CONNECTED: DWORD = 233;
const ERROR_BROKEN_PIPE: DWORD = 109;
const ERROR_PIPE_BUSY: DWORD = 231;
const FILE_ATTRIBUTE_REPARSE_POINT: DWORD = 0x0000_0400;
const ERROR_IO_PENDING: DWORD = 997;
const WAIT_OBJECT_0: DWORD = 0;
const WAIT_TIMEOUT: DWORD = 258;
const IPC_FRAME_TIMEOUT_MS: u64 = 2500;
const OPEN_EXISTING: DWORD = 3;
const GENERIC_READ: DWORD = 0x8000_0000;
const GENERIC_WRITE: DWORD = 0x4000_0000;
// The client needs the two data rights plus READ_ATTRIBUTES for the pipe
// handle operations used by the Windows client. FILE_CREATE_PIPE_INSTANCE
// (0x4) is deliberately excluded from both this request mask and the DACL.
const IPC_CLIENT_ACCESS: DWORD = 0x0012_0183;
const FILE_CREATE_PIPE_INSTANCE: DWORD = 0x0000_0004;
const PIPE_CLIENT_ACL_MASK: DWORD = IPC_CLIENT_ACCESS;
const FILE_SHARE_READ: DWORD = 1;
const FILE_SHARE_WRITE: DWORD = 2;
const FILE_SHARE_DELETE: DWORD = 4;
const PIPE_ACCESS_DUPLEX: DWORD = 3;
const FILE_FLAG_FIRST_PIPE_INSTANCE: DWORD = 0x0008_0000;
const FILE_FLAG_BACKUP_SEMANTICS: DWORD = 0x0200_0000;
const PIPE_TYPE_MESSAGE: DWORD = 4;
const PIPE_READMODE_MESSAGE: DWORD = 2;
const PIPE_WAIT: DWORD = 0;
const PIPE_NOWAIT: DWORD = 1;
const FILE_FLAG_OVERLAPPED: DWORD = 0x4000_0000;
const PIPE_REJECT_REMOTE_CLIENTS: DWORD = 8;
const TOKEN_QUERY: DWORD = 0x0008;
const WRITE_DAC: DWORD = 0x0004_0000;
const TOKEN_USER: DWORD = 1;
const TOKEN_INTEGRITY_LEVEL: DWORD = 25;
const TOKEN_PRIVILEGES_CLASS: DWORD = 3;
const TOKEN_RESTRICTED_SIDS: DWORD = 11;
const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;
const SE_KERNEL_OBJECT: DWORD = 6;
const DACL_SECURITY_INFORMATION: DWORD = 0x0000_0004;
const SERVICE_WIN32_OWN_PROCESS: DWORD = 0x10;
const SERVICE_START_PENDING: DWORD = 2;
const SERVICE_RUNNING: DWORD = 4;
const SERVICE_STOP_PENDING: DWORD = 3;
const SERVICE_STOPPED: DWORD = 1;
const SERVICE_ACCEPT_STOP: DWORD = 1;
const SERVICE_CONTROL_STOP: DWORD = 1;
const SERVICE_CONTROL_INTERROGATE: DWORD = 4;
const SERVICE_ERROR_NORMAL: DWORD = 1;
const SERVICE_STATUS_HANDLE_INVALID: isize = 0;
const TOKEN_INFORMATION_CLASS_USER: DWORD = TOKEN_USER;

#[repr(C)]
struct SECURITY_ATTRIBUTES {
    nLength: DWORD,
    lpSecurityDescriptor: *mut c_void,
    bInheritHandle: BOOL,
}
#[repr(C)]
struct OVERLAPPED {
    Internal: usize,
    InternalHigh: usize,
    Offset: DWORD,
    OffsetHigh: DWORD,
    hEvent: HANDLE,
}
#[repr(C)]
struct SID_AND_ATTRIBUTES {
    Sid: *mut c_void,
    Attributes: DWORD,
}
#[repr(C)]
struct TOKEN_USER_STRUCT {
    User: SID_AND_ATTRIBUTES,
}
#[repr(C)]
struct TOKEN_GROUPS_ONE {
    GroupCount: DWORD,
    Groups: [SID_AND_ATTRIBUTES; 1],
}
#[repr(C)]
struct TOKEN_MANDATORY_LABEL {
    Label: SID_AND_ATTRIBUTES,
}
#[repr(C)]
struct SERVICE_TABLE_ENTRYW {
    lpServiceName: *mut u16,
    lpServiceProc: LPSERVICE_MAIN_FUNCTIONW,
}
#[repr(C)]
struct SERVICE_STATUS {
    dwServiceType: DWORD,
    dwCurrentState: DWORD,
    dwControlsAccepted: DWORD,
    dwWin32ExitCode: DWORD,
    dwServiceSpecificExitCode: DWORD,
    dwCheckPoint: DWORD,
    dwWaitHint: DWORD,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct BY_HANDLE_FILE_INFORMATION {
    dwFileAttributes: DWORD,
    ftCreationTimeLow: DWORD,
    ftCreationTimeHigh: DWORD,
    ftLastAccessTimeLow: DWORD,
    ftLastAccessTimeHigh: DWORD,
    ftLastWriteTimeLow: DWORD,
    ftLastWriteTimeHigh: DWORD,
    dwVolumeSerialNumber: DWORD,
    nFileSizeHigh: DWORD,
    nFileSizeLow: DWORD,
    nNumberOfLinks: DWORD,
    nFileIndexHigh: DWORD,
    nFileIndexLow: DWORD,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateNamedPipeW(
        name: *const u16,
        open_mode: DWORD,
        pipe_mode: DWORD,
        max_instances: DWORD,
        out_buffer: DWORD,
        in_buffer: DWORD,
        timeout: DWORD,
        security: *mut SECURITY_ATTRIBUTES,
    ) -> HANDLE;
    fn ConnectNamedPipe(pipe: HANDLE, overlapped: *mut c_void) -> BOOL;
    fn DisconnectNamedPipe(pipe: HANDLE) -> BOOL;
    fn ReadFile(
        file: HANDLE,
        buffer: *mut c_void,
        bytes: DWORD,
        read: *mut DWORD,
        overlapped: *mut c_void,
    ) -> BOOL;
    fn PeekNamedPipe(
        pipe: HANDLE,
        buffer: *mut c_void,
        buffer_size: DWORD,
        bytes_read: *mut DWORD,
        total_bytes_avail: *mut DWORD,
        bytes_left_this_message: *mut DWORD,
    ) -> BOOL;
    fn WriteFile(
        file: HANDLE,
        buffer: *const c_void,
        bytes: DWORD,
        written: *mut DWORD,
        overlapped: *mut c_void,
    ) -> BOOL;
    fn FlushFileBuffers(file: HANDLE) -> BOOL;
    fn CreateFileW(
        name: *const u16,
        access: DWORD,
        share: DWORD,
        security: *mut SECURITY_ATTRIBUTES,
        creation: DWORD,
        flags: DWORD,
        template: HANDLE,
    ) -> HANDLE;
    fn WaitNamedPipeW(name: *const u16, timeout: DWORD) -> BOOL;
    fn SetNamedPipeHandleState(
        pipe: HANDLE,
        mode: *mut DWORD,
        max_collection: *mut DWORD,
        timeout: *mut DWORD,
    ) -> BOOL;
    fn CloseHandle(handle: HANDLE) -> BOOL;
    fn GetLastError() -> DWORD;
    fn CreateEventW(
        security: *mut SECURITY_ATTRIBUTES,
        manual_reset: BOOL,
        initial_state: BOOL,
        name: *const u16,
    ) -> HANDLE;
    fn WaitForSingleObject(handle: HANDLE, milliseconds: DWORD) -> DWORD;
    fn GetOverlappedResult(
        file: HANDLE,
        overlapped: *mut OVERLAPPED,
        transferred: *mut DWORD,
        wait: BOOL,
    ) -> BOOL;
    fn CancelIoEx(file: HANDLE, overlapped: *mut OVERLAPPED) -> BOOL;
    fn GetTickCount64() -> u64;
    fn Sleep(ms: DWORD);
    fn GetCurrentThread() -> HANDLE;
    fn GetCurrentProcess() -> HANDLE;
    fn GetCurrentProcessId() -> DWORD;
    fn OpenProcess(access: DWORD, inherit: BOOL, process_id: DWORD) -> HANDLE;
    fn GetProcessId(process: HANDLE) -> DWORD;
    fn GetNamedPipeServerProcessId(pipe: HANDLE, process_id: *mut DWORD) -> BOOL;
    fn GetFileInformationByHandle(handle: HANDLE, info: *mut BY_HANDLE_FILE_INFORMATION) -> BOOL;
    fn GetNamedPipeClientProcessId(pipe: HANDLE, pid: *mut DWORD) -> BOOL;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
        sddl: *const u16,
        revision: DWORD,
        descriptor: *mut *mut c_void,
        size: *mut DWORD,
    ) -> BOOL;
    fn ConvertSidToStringSidW(sid: *mut c_void, string_sid: *mut *mut u16) -> BOOL;
    fn LookupAccountNameW(
        system: *const u16,
        account: *const u16,
        sid: *mut c_void,
        sid_size: *mut DWORD,
        domain: *mut u16,
        domain_size: *mut DWORD,
        use_type: *mut SID_NAME_USE,
    ) -> BOOL;
    fn LookupPrivilegeNameW(
        system_name: *const u16,
        luid: *const LUID,
        name: *mut u16,
        name_length: *mut DWORD,
    ) -> BOOL;
    fn CheckTokenMembership(token: HANDLE, sid: *mut c_void, member: *mut BOOL) -> BOOL;
    fn OpenProcessToken(process: HANDLE, access: DWORD, token: *mut HANDLE) -> BOOL;
    fn GetSecurityDescriptorDacl(
        descriptor: *mut c_void,
        present: *mut BOOL,
        dacl: *mut *mut c_void,
        defaulted: *mut BOOL,
    ) -> BOOL;
    fn SetSecurityInfo(
        handle: HANDLE,
        object_type: DWORD,
        security_info: DWORD,
        owner: *mut c_void,
        group: *mut c_void,
        dacl: *mut c_void,
        sacl: *mut c_void,
    ) -> DWORD;
    fn OpenThreadToken(
        thread: HANDLE,
        access: DWORD,
        open_as_self: BOOL,
        token: *mut HANDLE,
    ) -> BOOL;
    fn GetTokenInformation(
        token: HANDLE,
        class: DWORD,
        info: *mut c_void,
        length: DWORD,
        needed: *mut DWORD,
    ) -> BOOL;
    fn ImpersonateNamedPipeClient(pipe: HANDLE) -> BOOL;
    fn RevertToSelf() -> BOOL;
    fn StartServiceCtrlDispatcherW(table: *const SERVICE_TABLE_ENTRYW) -> BOOL;
    fn RegisterServiceCtrlHandlerExW(
        name: *const u16,
        handler: LPHANDLER_FUNCTION_EX,
        context: *mut c_void,
    ) -> isize;
    fn SetServiceStatus(status_handle: isize, status: *const SERVICE_STATUS) -> BOOL;
    fn LocalFree(memory: HANDLE) -> HANDLE;
    fn EqualSid(left: *mut c_void, right: *mut c_void) -> BOOL;
    fn GetSidSubAuthorityCount(sid: *mut c_void) -> *mut u8;
    fn GetSidSubAuthority(sid: *mut c_void, index: DWORD) -> *mut DWORD;
}

pub fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}
fn json_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\u{08}' => escaped.push_str("\\b"),
            '\u{0C}' => escaped.push_str("\\f"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                escaped.push_str(&format!("\\u{:04x}", control as u32))
            }
            other => escaped.push(other),
        }
    }
    escaped.push('"');
    escaped
}
fn json_privileges(privileges: &[TokenPrivilege]) -> String {
    let values: Vec<String> = privileges
        .iter()
        .map(|privilege| {
            format!(
                "{{\"name\":{},\"attributes\":{},\"enabled\":{}}}",
                json_string(&privilege.name),
                privilege.attributes,
                privilege.attributes & 0x2 != 0
            )
        })
        .collect();
    format!("[{}]", values.join(","))
}

#[cfg(test)]
mod json_encoding_tests {
    use super::{json_privileges, json_string, TokenPrivilege};

    #[test]
    fn escapes_json_quotes_backslashes_and_control_characters() {
        assert_eq!(
            json_string("quote\" slash\\ line\n tab\t control\u{0001}"),
            "\"quote\\\" slash\\\\ line\\n tab\\t control\\u0001\""
        );
    }

    #[test]
    fn privilege_records_include_name_attributes_and_enabled_state() {
        let json = json_privileges(&[TokenPrivilege {
            name: "SeChangeNotifyPrivilege".into(),
            attributes: 2,
        }]);
        assert_eq!(
            json,
            "[{\"name\":\"SeChangeNotifyPrivilege\",\"attributes\":2,\"enabled\":true}]"
        );
    }
}
fn error_text() -> String {
    let e = io::Error::last_os_error();
    format!("WIN32_{}:{e}", unsafe { GetLastError() })
}
fn check(ok: BOOL, operation: &str) -> Result<(), String> {
    if ok == 0 {
        Err(format!("{operation}:{}", error_text()))
    } else {
        Ok(())
    }
}
unsafe fn close(handle: HANDLE) {
    if !handle.is_null() && handle != INVALID_HANDLE_VALUE {
        CloseHandle(handle);
    }
}

fn token_user_sid(token: HANDLE) -> Result<String, String> {
    unsafe {
        let mut needed = 0;
        GetTokenInformation(
            token,
            TOKEN_INFORMATION_CLASS_USER,
            null_mut(),
            0,
            &mut needed,
        );
        if needed == 0 {
            return Err(format!("TOKEN_INFORMATION_SIZE:{}", error_text()));
        }
        let mut storage = vec![0u64; (needed as usize + 7) / 8];
        check(
            GetTokenInformation(
                token,
                TOKEN_INFORMATION_CLASS_USER,
                storage.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ),
            "GetTokenInformation(TokenUser)",
        )?;
        let user = &*(storage.as_ptr().cast::<TOKEN_USER_STRUCT>());
        let mut text = null_mut();
        check(
            ConvertSidToStringSidW(user.User.Sid, &mut text),
            "ConvertSidToStringSid",
        )?;
        let result = String::from_utf16_lossy(std::slice::from_raw_parts(text, nul_len(text)));
        LocalFree(text.cast());
        Ok(result)
    }
}

fn token_has_sid_in_list(
    token: HANDLE,
    token_class: DWORD,
    expected_sid: *mut c_void,
) -> Result<Option<DWORD>, String> {
    unsafe {
        let mut needed = 0;
        GetTokenInformation(token, token_class, null_mut(), 0, &mut needed);
        if needed == 0 {
            return Err(format!(
                "TOKEN_SID_LIST_SIZE:{token_class}:{}",
                error_text()
            ));
        }
        let mut storage = vec![0u64; (needed as usize + 7) / 8];
        check(
            GetTokenInformation(
                token,
                token_class,
                storage.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ),
            "GetTokenInformation(TokenSidList)",
        )?;
        let groups = storage.as_ptr().cast::<TOKEN_GROUPS_ONE>();
        let count = (*groups).GroupCount as usize;
        let entries = std::ptr::addr_of!((*groups).Groups).cast::<SID_AND_ATTRIBUTES>();
        for index in 0..count {
            let entry = &*entries.add(index);
            if EqualSid(entry.Sid, expected_sid) != 0 {
                return Ok(Some(entry.Attributes));
            }
        }
        Ok(None)
    }
}

fn token_has_normal_group(token: HANDLE, expected_sid: *mut c_void) -> Result<bool, String> {
    Ok(token_has_sid_in_list(token, 2, expected_sid)?
        .is_some_and(|attributes| attributes & 0x4 != 0))
}

fn token_has_restricted_sid(token: HANDLE, expected_sid: *mut c_void) -> Result<bool, String> {
    Ok(token_has_sid_in_list(token, TOKEN_RESTRICTED_SIDS, expected_sid)?.is_some())
}

fn classify_service_identity(
    user_sid: &str,
    service_sid: &str,
    group_present: bool,
    restricted_present: bool,
) -> Option<&'static str> {
    if user_sid == "S-1-5-19" && group_present && restricted_present {
        Some("LocalServiceRestricted")
    } else if user_sid == service_sid && restricted_present {
        // The virtual service SID is the primary user SID, so it need not also
        // appear in TokenGroups. Membership and restricted-list presence are
        // independently checked before this classifier is called.
        Some("VirtualServiceAccount")
    } else {
        None
    }
}

#[cfg(test)]
mod identity_classification_tests {
    use super::classify_service_identity;

    #[test]
    fn accepts_only_the_two_reviewed_service_identity_shapes() {
        assert_eq!(
            classify_service_identity("S-1-5-19", "S-1-5-80-1", true, true),
            Some("LocalServiceRestricted")
        );
        assert_eq!(
            classify_service_identity("S-1-5-80-1", "S-1-5-80-1", true, true),
            Some("VirtualServiceAccount")
        );
        assert_eq!(
            classify_service_identity("S-1-5-80-1", "S-1-5-80-1", false, true),
            Some("VirtualServiceAccount")
        );
        assert_eq!(
            classify_service_identity("S-1-5-19", "S-1-5-80-1", true, false),
            None
        );
        assert_eq!(
            classify_service_identity("S-1-5-80-1", "S-1-5-80-1", true, false),
            None
        );
        assert_eq!(
            classify_service_identity("S-1-5-21-evil", "S-1-5-80-1", true, true),
            None
        );
    }
}

unsafe fn nul_len(mut p: *const u16) -> usize {
    let mut n = 0;
    while *p != 0 {
        p = p.add(1);
        n += 1;
    }
    n
}

pub fn current_process_user_sid() -> Result<String, String> {
    unsafe {
        let mut token = null_mut();
        check(
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
            "OpenProcessToken",
        )?;
        let r = token_user_sid(token);
        close(token);
        r
    }
}

unsafe fn lookup_privilege_name(luid: &LUID) -> Result<String, String> {
    let mut name_length = 0;
    LookupPrivilegeNameW(null(), luid, null_mut(), &mut name_length);
    let first_error = GetLastError();
    if first_error != ERROR_INSUFFICIENT_BUFFER || name_length == 0 {
        return Err(format!("LOOKUP_PRIVILEGE_NAME_SIZE:{first_error}"));
    }
    let mut name = vec![0u16; name_length as usize + 1];
    let mut capacity = name.len() as DWORD;
    check(
        LookupPrivilegeNameW(null(), luid, name.as_mut_ptr(), &mut capacity),
        "LookupPrivilegeName",
    )?;
    let actual_len = (capacity as usize).min(name.len());
    Ok(String::from_utf16_lossy(&name[..actual_len]))
}

fn process_identity_fields() -> Result<ProcessIdentity, String> {
    unsafe {
        let mut token = null_mut();
        check(
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
            "OpenProcessToken(identity)",
        )?;
        let result = (|| {
            let user = token_user_sid(token)?;
            let mut needed = 0;
            GetTokenInformation(token, TOKEN_INTEGRITY_LEVEL, null_mut(), 0, &mut needed);
            if needed == 0 {
                return Err(format!("TOKEN_INTEGRITY_SIZE:{}", error_text()));
            }
            let mut label_storage = vec![0u64; (needed as usize + 7) / 8];
            check(
                GetTokenInformation(
                    token,
                    TOKEN_INTEGRITY_LEVEL,
                    label_storage.as_mut_ptr().cast(),
                    needed,
                    &mut needed,
                ),
                "GetTokenInformation(Integrity)",
            )?;
            let label = &*(label_storage.as_ptr().cast::<TOKEN_MANDATORY_LABEL>());
            let count = GetSidSubAuthorityCount(label.Label.Sid);
            if count.is_null() || *count == 0 {
                return Err("TOKEN_INTEGRITY_SID_INVALID".into());
            }
            let rid_ptr = GetSidSubAuthority(label.Label.Sid, (*count - 1) as DWORD);
            if rid_ptr.is_null() {
                return Err("TOKEN_INTEGRITY_RID_MISSING".into());
            }
            let rid = *rid_ptr;
            let mut privilege_bytes = 0;
            GetTokenInformation(
                token,
                TOKEN_PRIVILEGES_CLASS,
                null_mut(),
                0,
                &mut privilege_bytes,
            );
            if privilege_bytes == 0 {
                return Err(format!("TOKEN_PRIVILEGES_SIZE:{}", error_text()));
            }
            let mut privileges = vec![0u64; (privilege_bytes as usize + 7) / 8];
            check(
                GetTokenInformation(
                    token,
                    TOKEN_PRIVILEGES_CLASS,
                    privileges.as_mut_ptr().cast(),
                    privilege_bytes,
                    &mut privilege_bytes,
                ),
                "GetTokenInformation(Privileges)",
            )?;
            let raw = privileges.as_ptr().cast::<u8>();
            let privilege_count = raw.cast::<DWORD>().read_unaligned();
            if privilege_count > 4096 {
                return Err(format!(
                    "TOKEN_PRIVILEGE_COUNT_IMPLAUSIBLE:{privilege_count}"
                ));
            }
            let entries = raw.add(size_of::<DWORD>());
            let mut privilege_entries = Vec::with_capacity(privilege_count as usize);
            let mut enabled = 0;
            for idx in 0..privilege_count as usize {
                let entry = entries.add(idx * 12);
                let luid = LUID {
                    LowPart: entry.cast::<DWORD>().read_unaligned(),
                    HighPart: entry.add(4).cast::<i32>().read_unaligned(),
                };
                let attributes = entry.add(8).cast::<DWORD>().read_unaligned();
                if attributes & 0x2 != 0 {
                    enabled += 1;
                }
                privilege_entries.push(TokenPrivilege {
                    name: lookup_privilege_name(&luid)?,
                    attributes,
                });
            }
            Ok(ProcessIdentity {
                user_sid: user,
                integrity_rid: rid,
                privilege_count,
                enabled_privilege_count: enabled,
                privileges: privilege_entries,
            })
        })();
        close(token);
        result
    }
}

pub fn process_identity_json() -> Result<String, String> {
    let identity = process_identity_fields()?;
    let privileges = json_privileges(&identity.privileges);
    Ok(format!("{{\"schema\":\"SYLPH_G1_PROCESS_IDENTITY_2\",\"processId\":{},\"userSid\":{},\"integrityRid\":{},\"privilegeCount\":{},\"enabledPrivilegeCount\":{},\"privileges\":{privileges}}}", unsafe { GetCurrentProcessId() }, json_string(&identity.user_sid), identity.integrity_rid, identity.privilege_count, identity.enabled_privilege_count))
}

fn lookup_sid(account: &str) -> Result<(*mut c_void, Vec<u64>), String> {
    unsafe {
        let account_w = wide(account);
        let mut sid_bytes = 0;
        let mut domain_chars = 0;
        let mut use_type = 0;
        LookupAccountNameW(
            null(),
            account_w.as_ptr(),
            null_mut(),
            &mut sid_bytes,
            null_mut(),
            &mut domain_chars,
            &mut use_type,
        );
        if GetLastError() != ERROR_INSUFFICIENT_BUFFER || sid_bytes == 0 {
            return Err(format!("LookupAccountName(size):{}", error_text()));
        }
        let mut sid = vec![0u64; (sid_bytes as usize + 7) / 8];
        let mut domain = vec![0u16; domain_chars as usize + 2];
        check(
            LookupAccountNameW(
                null(),
                account_w.as_ptr(),
                sid.as_mut_ptr().cast(),
                &mut sid_bytes,
                domain.as_mut_ptr(),
                &mut domain_chars,
                &mut use_type,
            ),
            "LookupAccountName",
        )?;
        Ok((sid.as_mut_ptr().cast(), sid))
    }
}

fn lookup_account_sid_text(account: &str) -> Result<String, String> {
    unsafe {
        let (sid, _storage) = lookup_sid(account)?;
        let mut text = null_mut();
        check(
            ConvertSidToStringSidW(sid, &mut text),
            "ConvertSidToStringSid(account)",
        )?;
        let value = String::from_utf16_lossy(std::slice::from_raw_parts(text, nul_len(text)));
        LocalFree(text.cast());
        Ok(value)
    }
}

pub fn current_process_is_member(account: &str) -> Result<bool, String> {
    unsafe {
        let (sid, _storage) = lookup_sid(account)?;
        let mut member = 0;
        check(
            CheckTokenMembership(null_mut(), sid, &mut member),
            "CheckTokenMembership",
        )?;
        Ok(member != 0)
    }
}

fn current_thread_user_sid_after_impersonation() -> Result<String, String> {
    unsafe {
        let mut token = null_mut();
        check(
            OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut token),
            "OpenThreadToken(client)",
        )?;
        let result = token_user_sid(token);
        close(token);
        result
    }
}

pub fn file_identity(path: &str) -> Result<BY_HANDLE_FILE_INFORMATION, String> {
    unsafe {
        let name = wide(path);
        let handle = CreateFileW(
            name.as_ptr(),
            0x80,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE {
            return Err(format!("CreateFile(FILE_READ_ATTRIBUTES):{}", error_text()));
        }
        let mut info = std::mem::zeroed();
        let result = GetFileInformationByHandle(handle, &mut info);
        close(handle);
        check(result, "GetFileInformationByHandle")?;
        Ok(info)
    }
}

#[cfg(test)]
mod file_identity_tests {
    use super::{file_identity, GetCurrentProcessId, GetTickCount64};

    #[test]
    fn reads_file_and_directory_ids_from_scratch_paths() {
        let root = std::env::temp_dir().join(format!(
            "sylph-file-identity-{}-{}",
            unsafe { GetCurrentProcessId() },
            unsafe { GetTickCount64() }
        ));
        std::fs::create_dir(&root).unwrap();
        let child = root.join("child.txt");
        std::fs::write(&child, b"synthetic").unwrap();

        let directory = file_identity(root.to_string_lossy().as_ref()).unwrap();
        let file = file_identity(child.to_string_lossy().as_ref()).unwrap();
        assert_ne!(directory.dwFileAttributes & 0x10, 0);
        assert_eq!(file.dwFileAttributes & 0x10, 0);
        assert_ne!(
            (
                directory.dwVolumeSerialNumber,
                directory.nFileIndexHigh,
                directory.nFileIndexLow
            ),
            (
                file.dwVolumeSerialNumber,
                file.nFileIndexHigh,
                file.nFileIndexLow
            )
        );

        std::fs::remove_dir_all(root).unwrap();
    }
}

pub mod identity {
    use super::*;
    fn id_eq(a: &BY_HANDLE_FILE_INFORMATION, b: &BY_HANDLE_FILE_INFORMATION) -> bool {
        a.dwVolumeSerialNumber == b.dwVolumeSerialNumber
            && a.nFileIndexHigh == b.nFileIndexHigh
            && a.nFileIndexLow == b.nFileIndexLow
    }
    pub fn describe(path: &str) -> Result<String, String> {
        let i = file_identity(path)?;
        Ok(format!("{{\"path\":{},\"volumeSerial\":{},\"fileIndexHigh\":{},\"fileIndexLow\":{},\"links\":{},\"size\":{}}}", json_string(path), i.dwVolumeSerialNumber, i.nFileIndexHigh, i.nFileIndexLow, i.nNumberOfLinks, ((i.nFileSizeHigh as u64) << 32) | i.nFileSizeLow as u64))
    }
    pub fn compare(left: &str, right: &str, expect_same: bool) -> Result<String, String> {
        let a = file_identity(left)?;
        let b = file_identity(right)?;
        let same = id_eq(&a, &b);
        if same != expect_same {
            return Err(format!("FILE_IDENTITY_ASSERTION_FAILED:same={same}"));
        }
        Ok(format!("{{\"sameObject\":{same},\"leftVolume\":{},\"leftIndexHigh\":{},\"leftIndexLow\":{},\"rightVolume\":{},\"rightIndexHigh\":{},\"rightIndexLow\":{}}}", a.dwVolumeSerialNumber, a.nFileIndexHigh, a.nFileIndexLow, b.dwVolumeSerialNumber, b.nFileIndexHigh, b.nFileIndexLow))
    }
}

pub mod attack {
    use super::*;
    pub fn open_read_only(path: &str) -> Result<String, String> {
        let name = wide(path);
        let user_sid = current_process_user_sid()?;
        let pid = unsafe { GetCurrentProcessId() };
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null_mut(),
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            let code = unsafe { GetLastError() };
            let result = match code {
                5 => "ACCESS_DENIED",
                32 => "SHARING_VIOLATION",
                _ => "OPEN_FAILED",
            };
            return Ok(format!("{{\"schema\":\"SYLPH_G1_READ_ATTACK_1\",\"result\":\"{result}\",\"win32Error\":{code},\"requestedAccess\":{GENERIC_READ},\"userSid\":\"{user_sid}\",\"callerPid\":{pid}}}"));
        }
        unsafe { close(handle) };
        Ok(format!("{{\"schema\":\"SYLPH_G1_READ_ATTACK_1\",\"result\":\"READ_OPEN_SUCCEEDED\",\"win32Error\":0,\"requestedAccess\":{GENERIC_READ},\"userSid\":\"{user_sid}\",\"callerPid\":{pid}}}"))
    }

    pub fn hold_fake_pipe_server(ready_path: &str, release_path: &str) -> Result<String, String> {
        use std::fs::OpenOptions;
        use std::io::Write;
        use std::thread::sleep;
        use std::time::{Duration, Instant};

        if std::path::Path::new(release_path).exists() {
            return Err("RELEASE_MARKER_MUST_NOT_EXIST_BEFORE_START".into());
        }
        let caller_sid = current_process_user_sid()?;
        let caller_pid = unsafe { GetCurrentProcessId() };
        let name = wide(crate::win::pipe::PIPE_NAME);
        let open_mode = PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE;
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                open_mode,
                PIPE_TYPE_MESSAGE
                    | PIPE_READMODE_MESSAGE
                    | PIPE_NOWAIT
                    | PIPE_REJECT_REMOTE_CLIENTS,
                2,
                4096,
                4096,
                0,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            let error = unsafe { GetLastError() };
            return Ok(format!("{{\"schema\":\"SYLPH_G1_PIPE_HOLD_1\",\"result\":\"CREATE_FAILED\",\"win32Error\":{error},\"requestedOpenMode\":{open_mode},\"callerSid\":\"{caller_sid}\",\"callerPid\":{caller_pid}}}"));
        }
        let mut ready = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(ready_path)
        {
            Ok(file) => file,
            Err(error) => {
                unsafe { close(handle) };
                return Err(format!("READY_MARKER_CREATE:{error}"));
            }
        };
        if let Err(error) = writeln!(
            ready,
            "pid={caller_pid};sid={caller_sid};open_mode={open_mode}"
        ) {
            drop(ready);
            unsafe { close(handle) };
            return Err(format!("READY_MARKER_WRITE:{error}"));
        }
        if let Err(error) = ready.sync_all() {
            drop(ready);
            unsafe { close(handle) };
            return Err(format!("READY_MARKER_SYNC:{error}"));
        }
        drop(ready);

        // Keep the first-instance handle open without accepting or reading a
        // client request. The client-side identity check is tested separately;
        // this disposable process only reserves the namespace until release.
        let hold_started = Instant::now();
        let deadline = Instant::now() + Duration::from_secs(600);
        while Instant::now() < deadline {
            if std::path::Path::new(release_path).exists() {
                unsafe { close(handle) };
                return Ok(format!("{{\"schema\":\"SYLPH_G1_PIPE_HOLD_1\",\"result\":\"FIRST_INSTANCE_HELD_UNTIL_RELEASE\",\"requestedOpenMode\":{open_mode},\"callerSid\":\"{caller_sid}\",\"callerPid\":{caller_pid},\"firstInstanceHeld\":true,\"holdDurationMs\":{}}}", hold_started.elapsed().as_millis()));
            }
            sleep(Duration::from_millis(50));
        }
        unsafe { close(handle) };
        Err("PIPE_HOLDER_RELEASE_TIMEOUT".into())
    }

    pub fn try_create_pipe_instance(pipe_path: &str) -> Result<String, String> {
        let name = wide(pipe_path);
        let caller_sid = current_process_user_sid()?;
        let caller_pid = unsafe { GetCurrentProcessId() };
        let open_mode = PIPE_ACCESS_DUPLEX;
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                open_mode,
                PIPE_TYPE_MESSAGE
                    | PIPE_READMODE_MESSAGE
                    | PIPE_NOWAIT
                    | PIPE_REJECT_REMOTE_CLIENTS,
                2,
                64,
                64,
                0,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            let error = unsafe { GetLastError() };
            return Ok(format!(
                "{{\"schema\":\"SYLPH_G1_PIPE_INSTANCE_ATTACK_1\",\"result\":\"CREATE_DENIED\",\"win32Error\":{error},\"requestedOpenMode\":{open_mode},\"callerSid\":\"{caller_sid}\",\"callerPid\":{caller_pid}}}"
            ));
        }
        unsafe { close(handle) };
        Ok(format!(
            "{{\"schema\":\"SYLPH_G1_PIPE_INSTANCE_ATTACK_1\",\"result\":\"CREATE_SUCCEEDED\",\"win32Error\":0,\"requestedOpenMode\":{open_mode},\"callerSid\":\"{caller_sid}\",\"callerPid\":{caller_pid}}}"
        ))
    }

    pub fn pipe_instance_positive_control(pipe_path: &str) -> Result<String, String> {
        let name = wide(pipe_path);
        let caller_sid = current_process_user_sid()?;
        let caller_pid = unsafe { GetCurrentProcessId() };
        let first_mode = PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE;
        let instance_mode = PIPE_ACCESS_DUPLEX;
        let pipe_mode =
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS;
        let first = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                first_mode,
                pipe_mode,
                2,
                64,
                64,
                0,
                null_mut(),
            )
        };
        if first == INVALID_HANDLE_VALUE {
            let error = unsafe { GetLastError() };
            return Err(format!("PIPE_CONTROL_FIRST_CREATE:{error}"));
        }
        let second = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                instance_mode,
                pipe_mode,
                2,
                64,
                64,
                0,
                null_mut(),
            )
        };
        if second == INVALID_HANDLE_VALUE {
            let error = unsafe { GetLastError() };
            unsafe { close(first) };
            return Ok(format!(
                "{{\"schema\":\"SYLPH_G1_PIPE_INSTANCE_CONTROL_1\",\"result\":\"SECOND_INSTANCE_DENIED\",\"win32Error\":{error},\"requestedOpenMode\":{instance_mode},\"callerSid\":\"{caller_sid}\",\"callerPid\":{caller_pid}}}"
            ));
        }
        unsafe {
            close(second);
            close(first);
        }
        Ok(format!(
            "{{\"schema\":\"SYLPH_G1_PIPE_INSTANCE_CONTROL_1\",\"result\":\"SECOND_INSTANCE_CREATED\",\"win32Error\":0,\"requestedOpenMode\":{instance_mode},\"callerSid\":\"{caller_sid}\",\"callerPid\":{caller_pid}}}"
        ))
    }

    pub fn write_one_byte(path: &str) -> Result<String, String> {
        use std::io::{Read, Seek, SeekFrom, Write};
        use std::os::windows::io::FromRawHandle;
        let name = wide(path);
        let user_sid = current_process_user_sid()?;
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null_mut(),
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            let code = unsafe { GetLastError() };
            let result = match code {
                5 => "ACCESS_DENIED",
                32 => "SHARING_VIOLATION",
                _ => "OPEN_FAILED",
            };
            return Ok(format!("{{\"schema\":\"SYLPH_G1_ATTACK_RESULT_1\",\"result\":\"{result}\",\"win32Error\":{code},\"requestedAccess\":3221225472,\"userSid\":\"{user_sid}\"}}"));
        }
        let mut file = unsafe { std::fs::File::from_raw_handle(handle) };
        let mut byte = [0u8; 1];
        file.read_exact(&mut byte)
            .map_err(|e| format!("READ_ERROR:{e}"))?;
        file.seek(SeekFrom::Start(0))
            .map_err(|e| format!("SEEK_ERROR:{e}"))?;
        let changed = byte[0] ^ 0x01;
        file.write_all(&[changed])
            .map_err(|e| format!("WRITE_ERROR:{e}"))?;
        file.sync_all().map_err(|e| format!("SYNC_ERROR:{e}"))?;
        Ok(format!("{{\"schema\":\"SYLPH_G1_ATTACK_RESULT_1\",\"result\":\"WRITE_SUCCEEDED\",\"win32Error\":0,\"requestedAccess\":3221225472,\"userSid\":\"{user_sid}\",\"originalByte\":{},\"writtenByte\":{}}}",byte[0],changed))
    }

    pub fn write_only_one_byte(path: &str) -> Result<String, String> {
        use std::io::Write;
        use std::os::windows::io::FromRawHandle;
        let name = wide(path);
        let user_sid = current_process_user_sid()?;
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null_mut(),
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            let code = unsafe { GetLastError() };
            let result = match code {
                5 => "ACCESS_DENIED",
                32 => "SHARING_VIOLATION",
                _ => "OPEN_FAILED",
            };
            return Ok(format!("{{\"schema\":\"SYLPH_G1_ATTACK_RESULT_1\",\"result\":\"{result}\",\"win32Error\":{code},\"requestedAccess\":1073741824,\"userSid\":\"{user_sid}\"}}"));
        }
        let mut file = unsafe { std::fs::File::from_raw_handle(handle) };
        let marker = [0xA5u8];
        file.write_all(&marker)
            .map_err(|e| format!("WRITE_ERROR:{e}"))?;
        file.sync_all().map_err(|e| format!("SYNC_ERROR:{e}"))?;
        Ok(format!("{{\"schema\":\"SYLPH_G1_ATTACK_RESULT_1\",\"result\":\"WRITE_SUCCEEDED\",\"win32Error\":0,\"requestedAccess\":1073741824,\"userSid\":\"{user_sid}\",\"writtenByte\":{}}}", marker[0]))
    }
}

#[path = "sqlite.rs"]
pub mod sqlite;

pub mod pipe {
    use super::*;
    pub const PIPE_NAME: &str = r"\\.\pipe\SylphG1Broker";
    #[cfg(feature = "synthetic-maintenance")]
    pub const SYNTHETIC_MAINTENANCE_PIPE_NAME: &str =
        r"\\.\pipe\SylphG1SyntheticMaintenanceTestOnly";
    fn pipe_name() -> Vec<u16> {
        wide(PIPE_NAME)
    }
    pub fn disconnect_without_frame() -> Result<String, String> {
        unsafe {
            let sid = current_process_user_sid()?;
            let pid = GetCurrentProcessId();
            let name = pipe_name();
            if WaitNamedPipeW(name.as_ptr(), 5000) == 0 {
                return Err(format!("WAIT_PIPE:{}", error_text()));
            }
            let handle = CreateFileW(
                name.as_ptr(),
                IPC_CLIENT_ACCESS,
                0,
                null_mut(),
                OPEN_EXISTING,
                0,
                null_mut(),
            );
            if handle == INVALID_HANDLE_VALUE {
                return Err(format!("OPEN_PIPE:{}", error_text()));
            }
            close(handle);
            Ok(format!("{{\"schema\":\"SYLPH_G1_PIPE_DISCONNECT_1\",\"result\":\"HANDLE_OPENED_AND_CLOSED_WITHOUT_FRAME\",\"callerSid\":{},\"callerPid\":{pid}}}", json_string(&sid)))
        }
    }
    pub fn probe_client_acl(pipe_path: &str, mask_text: &str) -> Result<String, String> {
        let mask = u32::from_str_radix(mask_text.trim_start_matches("0x"), 16)
            .map_err(|_| "PIPE_ACL_PROBE_MASK_INVALID")?;
        let sid = current_process_user_sid()?;
        let pid = unsafe { GetCurrentProcessId() };
        unsafe {
            let sddl = wide(&format!("D:P(A;;0x{mask:08X};;;{sid})"));
            let mut descriptor = null_mut();
            check(
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut descriptor,
                    null_mut(),
                ),
                "PIPE_ACL_PROBE_SDDL",
            )?;
            let mut security = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as DWORD,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            };
            let name = wide(pipe_path);
            let server = CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_MESSAGE
                    | PIPE_READMODE_MESSAGE
                    | PIPE_NOWAIT
                    | PIPE_REJECT_REMOTE_CLIENTS,
                2,
                4096,
                4096,
                0,
                &mut security,
            );
            LocalFree(descriptor);
            if server == INVALID_HANDLE_VALUE {
                let error = GetLastError();
                return Ok(format!("{{\"schema\":\"SYLPH_G1_PIPE_ACL_PROBE_1\",\"result\":\"SERVER_CREATE_FAILED\",\"mask\":{mask},\"win32Error\":{error},\"callerSid\":{},\"callerPid\":{pid}}}", json_string(&sid)));
            }
            let connected = ConnectNamedPipe(server, null_mut());
            if connected == 0 && GetLastError() != ERROR_PIPE_LISTENING {
                let error = GetLastError();
                close(server);
                return Ok(format!("{{\"schema\":\"SYLPH_G1_PIPE_ACL_PROBE_1\",\"result\":\"SERVER_LISTEN_FAILED\",\"mask\":{mask},\"win32Error\":{error},\"callerSid\":{},\"callerPid\":{pid}}}", json_string(&sid)));
            }
            let client = CreateFileW(
                name.as_ptr(),
                IPC_CLIENT_ACCESS,
                0,
                null_mut(),
                OPEN_EXISTING,
                0,
                null_mut(),
            );
            if client != INVALID_HANDLE_VALUE {
                close(client);
                let _ = DisconnectNamedPipe(server);
                close(server);
                return Ok(format!("{{\"schema\":\"SYLPH_G1_PIPE_ACL_PROBE_1\",\"result\":\"CLIENT_OPEN_SUCCEEDED\",\"mask\":{mask},\"win32Error\":0,\"requestedAccess\":{IPC_CLIENT_ACCESS},\"callerSid\":{},\"callerPid\":{pid}}}", json_string(&sid)));
            }
            let error = GetLastError();
            close(server);
            Ok(format!("{{\"schema\":\"SYLPH_G1_PIPE_ACL_PROBE_1\",\"result\":\"CLIENT_OPEN_DENIED\",\"mask\":{mask},\"win32Error\":{error},\"requestedAccess\":{IPC_CLIENT_ACCESS},\"callerSid\":{},\"callerPid\":{pid}}}", json_string(&sid)))
        }
    }
    fn parse_frame(bytes: &[u8]) -> Result<String, String> {
        if bytes.len() > 2048 {
            return Err("IPC_MESSAGE_TOO_LARGE".into());
        }
        let text = std::str::from_utf8(bytes).map_err(|_| "IPC_NOT_UTF8")?;
        let frame = text
            .strip_suffix("\r\n")
            .or_else(|| text.strip_suffix('\n'))
            .ok_or("IPC_NEWLINE_REQUIRED")?;
        if frame.contains('\r') || frame.contains('\n') {
            return Err("IPC_MULTILINE_FRAME".into());
        }
        Ok(frame.to_string())
    }

    fn new_overlapped() -> Result<Box<OVERLAPPED>, String> {
        let event = unsafe { CreateEventW(null_mut(), 0, 0, null()) };
        if event.is_null() {
            return Err(format!("IPC_EVENT_CREATE:{}", error_text()));
        }
        Ok(Box::new(OVERLAPPED {
            Internal: 0,
            InternalHigh: 0,
            Offset: 0,
            OffsetHigh: 0,
            hEvent: event,
        }))
    }
    fn wait_overlapped(
        pipe: HANDLE,
        overlapped: &mut OVERLAPPED,
        timeout_ms: Option<u64>,
        operation: &str,
    ) -> Result<DWORD, String> {
        let started = unsafe { GetTickCount64() };
        loop {
            let wait = unsafe { WaitForSingleObject(overlapped.hEvent, 50) };
            if wait == WAIT_OBJECT_0 {
                let mut transferred = 0;
                if unsafe { GetOverlappedResult(pipe, overlapped, &mut transferred, 0) } == 0 {
                    let error = unsafe { GetLastError() };
                    if is_client_disconnect_error(error) {
                        return Err("IPC_CLIENT_DISCONNECTED".into());
                    }
                    if error == ERROR_MORE_DATA {
                        return Err("IPC_MESSAGE_TOO_LARGE".into());
                    }
                    return Err(format!("{operation}:{error}:{}", error_text()));
                }
                return Ok(transferred);
            }
            if wait != WAIT_TIMEOUT {
                return cancel_and_drain(pipe, overlapped).map_err(|(error, completed)| {
                    if completed {
                        format!("{operation}_WAIT_FAILED:{wait}:IO:{error}")
                    } else {
                        format!("IPC_IO_UNPROVEN:{operation}:{wait}:IO:{error}")
                    }
                });
            }
            let timed_out = timeout_ms
                .is_some_and(|limit| unsafe { GetTickCount64() }.saturating_sub(started) >= limit);
            if !service::stopping() && !timed_out {
                continue;
            }

            // Cancel, then use GetOverlappedResult(wait=true) as the completion
            // barrier. The caller may release buffers/events only after this
            // call returns, including when cancellation races completion.
            match cancel_and_drain(pipe, overlapped) {
                Ok(completed) => return Ok(completed),
                Err((error, _)) if error == 995 && service::stopping() => {
                    return Err("IPC_STOPPED".into())
                }
                Err((error, _)) if error == 995 && timed_out => {
                    return Err("IPC_FRAME_TIMEOUT".into())
                }
                Err((error, _)) if is_client_disconnect_error(error) => {
                    return Err("IPC_CLIENT_DISCONNECTED".into())
                }
                Err((error, completed)) => {
                    if !completed {
                        return Err(format!("IPC_IO_UNPROVEN:{operation}:CANCEL:{error}"));
                    }
                    return Err(format!("{operation}_CANCELLED:{error}:{}", error_text()));
                }
            }
        }
    }
    fn cancel_and_drain(pipe: HANDLE, overlapped: &mut OVERLAPPED) -> Result<DWORD, (DWORD, bool)> {
        unsafe {
            let cancelled = CancelIoEx(pipe, overlapped);
            let cancel_error = if cancelled == 0 { GetLastError() } else { 0 };
            let mut transferred = 0;
            if GetOverlappedResult(pipe, overlapped, &mut transferred, 1) != 0 {
                Ok(transferred)
            } else {
                let error = GetLastError();
                // GetOverlappedResult(TRUE) is the completion barrier. A few
                // errors explicitly mean that the barrier could not establish
                // completion; callers retain every referenced allocation.
                let completion_unproven =
                    matches!(error, 6 | 87 | 996) || (cancelled == 0 && cancel_error == 87);
                if completion_unproven {
                    Err((error, false))
                } else {
                    Err((error, true))
                }
            }
        }
    }

    fn read_message(handle: HANDLE) -> Result<String, String> {
        let mut buffer = vec![0u8; 4096];
        let mut overlapped = new_overlapped()?;
        let mut read = 0;
        let result = unsafe {
            if ReadFile(
                handle,
                buffer.as_mut_ptr().cast(),
                buffer.len() as DWORD,
                &mut read,
                (&mut *overlapped as *mut OVERLAPPED).cast(),
            ) != 0
            {
                Ok(read)
            } else {
                let error = GetLastError();
                if error == ERROR_IO_PENDING {
                    wait_overlapped(
                        handle,
                        &mut overlapped,
                        Some(IPC_FRAME_TIMEOUT_MS),
                        "IPC_READ",
                    )
                } else if is_client_disconnect_error(error) {
                    Err("IPC_CLIENT_DISCONNECTED".into())
                } else if error == ERROR_MORE_DATA {
                    Err("IPC_MESSAGE_TOO_LARGE".into())
                } else {
                    Err(format!("IPC_READ:{error}:{}", error_text()))
                }
            }
        };
        if result
            .as_ref()
            .is_err_and(|error| error.starts_with("IPC_IO_UNPROVEN"))
        {
            // Windows may still reference the OVERLAPPED and caller buffer.
            // Keep both allocations and the event alive, then retire the
            // endpoint; leaking here is safer than use-after-free.
            std::mem::forget(overlapped);
            std::mem::forget(buffer);
            return result.map(|_| String::new());
        }
        unsafe { close(overlapped.hEvent) };
        let read = result?;
        parse_frame(&buffer[..read as usize])
    }
    fn is_client_disconnect_error(error: DWORD) -> bool {
        matches!(
            error,
            ERROR_BROKEN_PIPE | ERROR_PIPE_NOT_CONNECTED | ERROR_NO_DATA
        )
    }
    fn write_message(handle: HANDLE, text: &str) -> Result<(), String> {
        let bytes = format!("{text}\n").into_bytes();
        let mut written = 0;
        let mut overlapped = new_overlapped()?;
        let result = unsafe {
            if WriteFile(
                handle,
                bytes.as_ptr().cast(),
                bytes.len() as DWORD,
                &mut written,
                (&mut *overlapped as *mut OVERLAPPED).cast(),
            ) != 0
            {
                Ok(written)
            } else {
                let error = GetLastError();
                if error == ERROR_IO_PENDING {
                    wait_overlapped(handle, &mut overlapped, Some(1000), "IPC_WRITE")
                } else if is_client_disconnect_error(error) {
                    Err("IPC_CLIENT_DISCONNECTED".into())
                } else {
                    Err(format!("IPC_WRITE:{error}:{}", error_text()))
                }
            }
        };
        if result
            .as_ref()
            .is_err_and(|error| error.starts_with("IPC_IO_UNPROVEN"))
        {
            std::mem::forget(overlapped);
            std::mem::forget(bytes);
            return result.map(|_| ());
        }
        unsafe { close(overlapped.hEvent) };
        written = result?;
        if written as usize != bytes.len() {
            return Err("IPC_PARTIAL_WRITE".into());
        }
        Ok(())
    }
    fn client_identity_matches(pipe: HANDLE, allowed_sid: &str) -> Result<bool, String> {
        unsafe {
            if ImpersonateNamedPipeClient(pipe) == 0 {
                return Ok(false);
            }
            let observed = current_thread_user_sid_after_impersonation();
            if RevertToSelf() == 0 {
                return Err(format!("REVERT_TO_SELF_FAILED:{}", error_text()));
            }
            Ok(matches!(observed, Ok(sid) if sid == allowed_sid))
        }
    }

    fn verify_server_process(pipe: HANDLE) -> Result<(), String> {
        unsafe {
            let mut server_pid = 0;
            check(
                GetNamedPipeServerProcessId(pipe, &mut server_pid),
                "GetNamedPipeServerProcessId",
            )?;
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, server_pid);
            if process.is_null() {
                return Err(format!("OPEN_PIPE_SERVER_PROCESS:{}", error_text()));
            }
            let result = (|| {
                if GetProcessId(process) != server_pid {
                    return Err("PIPE_SERVER_PID_MISMATCH".into());
                }
                let mut token = null_mut();
                check(
                    OpenProcessToken(process, TOKEN_QUERY, &mut token),
                    "OpenPipeServerToken",
                )?;
                let result = (|| {
                    let expected_account = "NT SERVICE\\SylphG1Broker";
                    let expected_sid_text = lookup_account_sid_text(expected_account)?;
                    let (expected_sid, _sid_storage) = lookup_sid(expected_account)?;
                    let user_sid = token_user_sid(token)?;
                    let group_present = token_has_normal_group(token, expected_sid)?;
                    let restricted_present = token_has_restricted_sid(token, expected_sid)?;
                    if classify_service_identity(
                        &user_sid,
                        &expected_sid_text,
                        group_present,
                        restricted_present,
                    )
                    .is_none()
                    {
                        return Err(format!("PIPE_SERVER_IDENTITY_REJECTED:{user_sid}"));
                    }
                    Ok(())
                })();
                close(token);
                result
            })();
            close(process);
            result
        }
    }
    pub(super) fn restrict_broker_process_dacl(
        service_sid: &str,
        client_sid: &str,
        synthetic_client_sid: Option<&str>,
    ) -> Result<(), String> {
        unsafe {
            let synthetic_ace = synthetic_client_sid
                .map(|sid| format!("(A;;0x1000;;;{sid})"))
                .unwrap_or_default();
            let sddl = wide(&format!(
                "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;{service_sid})(A;;0x1000;;;{client_sid}){synthetic_ace}"
            ));
            let mut descriptor = null_mut();
            check(
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut descriptor,
                    null_mut(),
                ),
                "ConvertProcessSecurityDescriptor",
            )?;
            let mut present = 0;
            let mut dacl = null_mut();
            let mut defaulted = 0;
            let extracted =
                GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted);
            if extracted == 0 || present == 0 || dacl.is_null() {
                LocalFree(descriptor);
                return Err(format!("PROCESS_DACL_EXTRACT_FAILED:{}", error_text()));
            }
            let result = SetSecurityInfo(
                GetCurrentProcess(),
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                dacl,
                null_mut(),
            );
            LocalFree(descriptor);
            if result != 0 {
                return Err(format!("PROCESS_DACL_SET_FAILED:{result}"));
            }
            Ok(())
        }
    }
    pub(super) fn restrict_broker_token_dacl(
        service_sid: &str,
        client_sid: &str,
        synthetic_client_sid: Option<&str>,
    ) -> Result<(), String> {
        unsafe {
            let mut token = null_mut();
            check(
                OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | WRITE_DAC, &mut token),
                "OpenBrokerTokenForDacl",
            )?;
            let synthetic_ace = synthetic_client_sid
                .map(|sid| format!("(A;;0x0008;;;{sid})"))
                .unwrap_or_default();
            let sddl = wide(&format!(
                "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;{service_sid})(A;;0x0008;;;{client_sid}){synthetic_ace}"
            ));
            let mut descriptor = null_mut();
            let converted = ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            );
            if converted == 0 {
                close(token);
                return Err(format!("CONVERT_TOKEN_DACL:{}", error_text()));
            }
            let mut present = 0;
            let mut dacl = null_mut();
            let mut defaulted = 0;
            let extracted =
                GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted);
            if extracted == 0 || present == 0 || dacl.is_null() {
                LocalFree(descriptor);
                close(token);
                return Err(format!("TOKEN_DACL_EXTRACT_FAILED:{}", error_text()));
            }
            let result = SetSecurityInfo(
                token,
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                dacl,
                null_mut(),
            );
            LocalFree(descriptor);
            close(token);
            if result != 0 {
                return Err(format!("TOKEN_DACL_SET_FAILED:{result}"));
            }
            Ok(())
        }
    }
    fn pipe_security(
        service_sid: &str,
        client_sid: &str,
    ) -> Result<(*mut c_void, SECURITY_ATTRIBUTES), String> {
        if !client_acl_mask_is_valid(PIPE_CLIENT_ACL_MASK) {
            return Err("PIPE_CLIENT_ACL_MASK_INVALID".into());
        }
        unsafe {
            let sddl = wide(&format!(
                "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;{service_sid})(A;;0x{PIPE_CLIENT_ACL_MASK:08X};;;{client_sid})"
            ));
            let mut descriptor = null_mut();
            check(
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut descriptor,
                    null_mut(),
                ),
                "ConvertStringSecurityDescriptorToSecurityDescriptor",
            )?;
            Ok((
                descriptor,
                SECURITY_ATTRIBUTES {
                    nLength: size_of::<SECURITY_ATTRIBUTES>() as DWORD,
                    lpSecurityDescriptor: descriptor,
                    bInheritHandle: 0,
                },
            ))
        }
    }
    fn client_acl_mask_is_valid(mask: DWORD) -> bool {
        mask == IPC_CLIENT_ACCESS && mask & FILE_CREATE_PIPE_INSTANCE == 0
    }
    #[cfg(test)]
    mod acl_policy_tests {
        use super::{
            client_acl_mask_is_valid, FILE_CREATE_PIPE_INSTANCE, IPC_CLIENT_ACCESS,
            PIPE_CLIENT_ACL_MASK,
        };

        #[test]
        fn configured_client_ace_excludes_pipe_instance_creation() {
            assert!(client_acl_mask_is_valid(PIPE_CLIENT_ACL_MASK));
            assert_eq!(PIPE_CLIENT_ACL_MASK & FILE_CREATE_PIPE_INSTANCE, 0);
        }

        #[test]
        fn verifier_detects_the_v64_broad_ace_mutation() {
            assert!(!client_acl_mask_is_valid(0x0012_019F));
            assert!(client_acl_mask_is_valid(IPC_CLIENT_ACCESS));
        }
    }
    pub fn serve(
        service_sid: &str,
        client_sid: &str,
        registry: &sqlite::Registry,
        on_pipe_created: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        serve_endpoint(
            PIPE_NAME,
            service_sid,
            client_sid,
            on_pipe_created,
            service::operation_guard,
            |request| dispatch(request, registry),
            "READINESS_PUBLICATION_FAILED",
        )
    }

    #[cfg(feature = "synthetic-maintenance")]
    pub fn serve_synthetic_maintenance(
        service_sid: &str,
        client_sid: &str,
        database_path: &std::path::Path,
    ) -> Result<(), String> {
        let mut on_pipe_created = || Ok(());
        serve_synthetic_maintenance_with_callback(
            service_sid,
            client_sid,
            database_path,
            &mut on_pipe_created,
        )
    }

    #[cfg(feature = "synthetic-maintenance")]
    pub(super) fn serve_synthetic_maintenance_with_callback(
        service_sid: &str,
        client_sid: &str,
        database_path: &std::path::Path,
        on_pipe_created: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        if client_sid == service_sid {
            return Err("SYNTHETIC_MAINTENANCE_CLIENT_SID_MUST_BE_DISTINCT".into());
        }
        serve_endpoint(
            SYNTHETIC_MAINTENANCE_PIPE_NAME,
            service_sid,
            client_sid,
            on_pipe_created,
            service::synthetic_operation_guard,
            |request| synthetic_maintenance::process_pipe_message(request, database_path),
            "SYNTHETIC_ENDPOINT_START_FAILED",
        )
    }

    fn serve_endpoint(
        endpoint_name: &str,
        service_sid: &str,
        client_sid: &str,
        on_pipe_created: &mut dyn FnMut() -> Result<(), String>,
        operation_guard: fn() -> std::sync::MutexGuard<'static, ()>,
        dispatch_request: impl Fn(&str) -> String,
        callback_error_prefix: &str,
    ) -> Result<(), String> {
        unsafe {
            let (descriptor, mut security) = pipe_security(service_sid, client_sid)?;
            let name = wide(endpoint_name);
            let handle = CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
                PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                2,
                4096,
                4096,
                0,
                &mut security,
            );
            LocalFree(descriptor);
            if handle == INVALID_HANDLE_VALUE {
                return Err(format!("CREATE_NAMED_PIPE:{}", error_text()));
            }
            if let Err(error) = on_pipe_created() {
                close(handle);
                return Err(format!("{callback_error_prefix}:{error}"));
            }
            while !service::stopping() {
                let mut connect = match new_overlapped() {
                    Ok(value) => value,
                    Err(error) => {
                        close(handle);
                        return Err(error);
                    }
                };
                let connected = ConnectNamedPipe(handle, (&mut *connect as *mut OVERLAPPED).cast());
                if connected == 0 {
                    let error = GetLastError();
                    if error == ERROR_PIPE_CONNECTED {
                        // The client connected between the previous
                        // disconnect and this call.
                    } else if error == ERROR_IO_PENDING {
                        match wait_overlapped(handle, &mut connect, None, "PIPE_CONNECT") {
                            Ok(_) => {}
                            Err(error) if error == "IPC_STOPPED" => {
                                close(connect.hEvent);
                                break;
                            }
                            Err(error) if error.starts_with("IPC_IO_UNPROVEN") => {
                                // The kernel may still reference the request,
                                // event and pipe. Retain all of them; retire
                                // service readiness through the caller's
                                // fatal result instead of risking reuse.
                                std::mem::forget(connect);
                                std::mem::forget(handle);
                                return Err(format!("PIPE_CONNECT_FAILED:{error}"));
                            }
                            Err(error) => {
                                close(connect.hEvent);
                                close(handle);
                                return Err(format!("PIPE_CONNECT_FAILED:{error}"));
                            }
                        }
                    } else if is_client_disconnect_error(error) {
                        // A fast client may open and close between connect
                        // attempts. This same server instance remains owned;
                        // disconnect it and retry instead of dropping the
                        // namespace or publishing stale readiness.
                        if DisconnectNamedPipe(handle) == 0 {
                            let disconnect_error = GetLastError();
                            if !matches!(disconnect_error, ERROR_PIPE_NOT_CONNECTED | ERROR_NO_DATA)
                            {
                                close(connect.hEvent);
                                close(handle);
                                return Err(format!(
                                    "PIPE_DISCONNECT_AFTER_RACE:{disconnect_error}:{}",
                                    error_text()
                                ));
                            }
                        }
                        close(connect.hEvent);
                        continue;
                    } else {
                        close(connect.hEvent);
                        close(handle);
                        return Err(format!("PIPE_CONNECT_FATAL:{error}:{}", error_text()));
                    }
                }
                close(connect.hEvent);
                // Read the bounded complete message before impersonating;
                // Windows binds the impersonation token to the client that
                // wrote the last message read from this pipe.
                let result = match read_message(handle) {
                    Err(error) if error == "IPC_STOPPED" => Ok(()),
                    Err(error) if error == "IPC_CLIENT_DISCONNECTED" => Ok(()),
                    Err(error) if error.starts_with("IPC_READ_WAIT_FAILED") => Err(error),
                    Err(_) => {
                        let _ = write_message(handle, "ERR|MALFORMED_REQUEST");
                        Ok(())
                    }
                    Ok(_) if service::stopping() => Ok(()),
                    Ok(request) => match client_identity_matches(handle, client_sid) {
                        Ok(false) => write_message(handle, "ERR|CLIENT_IDENTITY_DENIED")
                            .map_err(|error| format!("IPC_RESPONSE_WRITE_FAILED:{error}")),
                        Err(fatal) => Err(fatal),
                        Ok(true) => {
                            let _operation = operation_guard();
                            if service::stopping() {
                                Ok(())
                            } else {
                                let response = dispatch_request(&request);
                                write_message(handle, &response).map_err(|error| {
                                    if error.starts_with("IPC_IO_UNPROVEN") {
                                        error
                                    } else {
                                        format!("IPC_RESPONSE_WRITE_FAILED:{error}")
                                    }
                                })
                            }
                        }
                    },
                };
                if let Err(error) = &result {
                    if error.starts_with("IPC_IO_UNPROVEN")
                        || error.starts_with("IPC_READ_WAIT_FAILED")
                        || error.starts_with("IPC_RESPONSE_WRITE_FAILED")
                    {
                        // The operation has been drained or failed before
                        // dispatch. Retire readiness and stop this endpoint;
                        // an unknown acknowledgement must not leave a
                        // healthy-looking broker accepting new writes.
                        if !error.starts_with("IPC_IO_UNPROVEN") {
                            close(handle);
                        }
                        return Err(error.clone());
                    }
                }
                let disconnected = DisconnectNamedPipe(handle);
                if disconnected == 0 {
                    let error = GetLastError();
                    if error != ERROR_PIPE_NOT_CONNECTED && error != ERROR_NO_DATA {
                        close(handle);
                        return Err(format!("PIPE_DISCONNECT_FATAL:{error}:{}", error_text()));
                    }
                }
                if let Err(error) = result {
                    close(handle);
                    return Err(error);
                }
            }
            close(handle);
            Ok(())
        }
    }
    fn dispatch(request: &str, registry: &sqlite::Registry) -> String {
        if request == "STATUS" {
            return match registry.count() {
                Ok(n) => match registry.check_integrity() {
                    Ok(integrity) if integrity == "ok" => format!(
                        "STATUS|version={}|source={}|rows={n}|integrity={integrity}",
                        registry.version, registry.sourceid
                    ),
                    _ => "ERR|STATUS_UNAVAILABLE".into(),
                },
                Err(_) => "ERR|STATUS_UNAVAILABLE".into(),
            };
        }
        if let Some(rest) = request.strip_prefix("WRITE_TEST|") {
            let mut fields = rest.splitn(2, '|');
            let id = fields.next().unwrap_or("");
            let payload = fields.next().unwrap_or("");
            return match registry.append(id, payload) {
                Ok(true) => "OK|inserted".into(),
                Ok(false) => "OK|duplicate".into(),
                Err(error) if error == "REQUEST_ID_CONFLICT" => "ERR|REQUEST_ID_CONFLICT".into(),
                Err(_) => "ERR|REQUEST_REJECTED".into(),
            };
        }
        "ERR|FORBIDDEN_OPERATION".into()
    }

    #[cfg(test)]
    mod framing_tests {
        use super::{
            is_client_disconnect_error, parse_frame, ERROR_BROKEN_PIPE, ERROR_NO_DATA,
            ERROR_PIPE_NOT_CONNECTED,
        };

        #[test]
        fn accepts_one_bounded_utf8_message() {
            assert_eq!(parse_frame(b"STATUS\n").unwrap(), "STATUS");
            assert_eq!(parse_frame(b"STATUS\r\n").unwrap(), "STATUS");
        }

        #[test]
        fn rejects_bad_length_encoding_and_framing() {
            assert!(parse_frame(b"STATUS").is_err());
            assert!(parse_frame(b"STATUS\n\n").is_err());
            assert!(parse_frame(b"\xff\n").is_err());
            assert!(parse_frame(&vec![b'A'; 2049]).is_err());
        }

        #[test]
        fn identifies_peer_disconnect_results_without_treating_busy_as_disconnect() {
            assert!(is_client_disconnect_error(ERROR_BROKEN_PIPE));
            assert!(is_client_disconnect_error(ERROR_NO_DATA));
            assert!(is_client_disconnect_error(ERROR_PIPE_NOT_CONNECTED));
            assert!(!is_client_disconnect_error(super::ERROR_PIPE_BUSY));
            assert!(!is_client_disconnect_error(5));
        }
    }

    pub fn client_command(args: &[String]) -> Result<String, String> {
        #[cfg(feature = "synthetic-maintenance")]
        if matches!(args, [op] if op == "synthetic-import") {
            return synthetic_maintenance_client_command();
        }
        let request = match args {
            [op] if op == "status" => "STATUS".to_string(),
            [op] if op == "forbidden" => "RESET".to_string(),
            [op, id, payload] if op == "write" => format!("WRITE_TEST|{id}|{payload}"),
            _ => return Err("usage: status | write <request-id> <payload> | forbidden".into()),
        };
        unsafe {
            let name = pipe_name();
            if WaitNamedPipeW(name.as_ptr(), 5000) == 0 {
                return Err(format!("WAIT_PIPE:{}", error_text()));
            }
            let handle = CreateFileW(
                name.as_ptr(),
                IPC_CLIENT_ACCESS,
                0,
                null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                null_mut(),
            );
            if handle == INVALID_HANDLE_VALUE {
                return Err(format!("OPEN_PIPE:{}", error_text()));
            }
            if let Err(error) = verify_server_process(handle) {
                close(handle);
                return Err(error);
            }
            let mut mode = PIPE_READMODE_MESSAGE;
            let r = SetNamedPipeHandleState(handle, &mut mode, null_mut(), null_mut());
            if r == 0 {
                close(handle);
                return Err(format!("SET_PIPE_MODE:{}", error_text()));
            }
            let result = write_message(handle, &request).and_then(|_| read_message(handle));
            close(handle);
            result
        }
    }

    #[cfg(feature = "synthetic-maintenance")]
    fn synthetic_maintenance_client_command() -> Result<String, String> {
        const MAX_BINARY_FRAME: usize = 900;
        let mut input = Vec::new();
        io::stdin()
            .take((MAX_BINARY_FRAME + 5) as u64)
            .read_to_end(&mut input)
            .map_err(|_| "SYNTHETIC_FRAME_READ_FAILED")?;
        if input.len() < 4 || input.len() > MAX_BINARY_FRAME + 4 {
            return Err("SYNTHETIC_FRAME_LENGTH_INVALID".into());
        }
        let length = u32::from_be_bytes(input[..4].try_into().unwrap()) as usize;
        if length == 0 || length > MAX_BINARY_FRAME || input.len() != length + 4 {
            return Err("SYNTHETIC_FRAME_LENGTH_INVALID".into());
        }
        synthetic_maintenance_exchange(&input[4..], true)
    }

    #[cfg(feature = "synthetic-maintenance")]
    pub(super) fn synthetic_maintenance_exchange(
        frame: &[u8],
        verify_server_identity: bool,
    ) -> Result<String, String> {
        const MAX_BINARY_FRAME: usize = 900;
        if frame.is_empty() || frame.len() > MAX_BINARY_FRAME {
            return Err("SYNTHETIC_FRAME_LENGTH_INVALID".into());
        }
        let mut request = String::from("SYNTH_IMPORT_HEX|");
        for byte in frame {
            use std::fmt::Write as _;
            write!(&mut request, "{byte:02x}").map_err(|_| "SYNTHETIC_FRAME_ENCODE_FAILED")?;
        }
        unsafe {
            let name = wide(SYNTHETIC_MAINTENANCE_PIPE_NAME);
            let wait_started = GetTickCount64();
            let handle = loop {
                if WaitNamedPipeW(name.as_ptr(), 100) != 0 {
                    let candidate = CreateFileW(
                        name.as_ptr(),
                        IPC_CLIENT_ACCESS,
                        0,
                        null_mut(),
                        OPEN_EXISTING,
                        FILE_FLAG_OVERLAPPED,
                        null_mut(),
                    );
                    if candidate != INVALID_HANDLE_VALUE {
                        break candidate;
                    }
                }
                let error = GetLastError();
                if !matches!(error, ERROR_FILE_NOT_FOUND | ERROR_PIPE_BUSY | 121) {
                    return Err(format!("OPEN_SYNTHETIC_PIPE:{error}:{}", error_text()));
                }
                if GetTickCount64().saturating_sub(wait_started) >= 5000 {
                    return Err(format!("WAIT_SYNTHETIC_PIPE:{error}:{}", error_text()));
                }
                Sleep(20);
            };
            if verify_server_identity {
                if let Err(error) = verify_server_process(handle) {
                    close(handle);
                    return Err(error);
                }
            }
            let mut mode = PIPE_READMODE_MESSAGE;
            if SetNamedPipeHandleState(handle, &mut mode, null_mut(), null_mut()) == 0 {
                close(handle);
                return Err(format!("SET_SYNTHETIC_PIPE_MODE:{}", error_text()));
            }
            let result = write_message(handle, &request).and_then(|_| read_message(handle));
            close(handle);
            result
        }
    }
}

pub mod service {
    use super::*;
    use std::io::Write;
    static STOP: AtomicBool = AtomicBool::new(false);
    static AUTHORITY_OPERATION_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    #[cfg(feature = "synthetic-maintenance")]
    static SYNTHETIC_OPERATION_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static READINESS_PATH: OnceLock<PathBuf> = OnceLock::new();
    static READINESS_WITHDRAWAL_ERROR: std::sync::Mutex<Option<String>> =
        std::sync::Mutex::new(None);
    static STATUS_HANDLE: AtomicIsize = AtomicIsize::new(SERVICE_STATUS_HANDLE_INVALID);
    static CURRENT_SERVICE_STATE: AtomicU32 = AtomicU32::new(SERVICE_STOPPED);
    static CURRENT_AUTHORITY_STATE: AtomicU32 = AtomicU32::new(0);
    const AUTHORITY_STARTING: u32 = 0;
    const AUTHORITY_VERIFYING: u32 = 1;
    const AUTHORITY_READY: u32 = 2;
    const AUTHORITY_RECOVERY_REQUIRED: u32 = 3;
    const AUTHORITY_QUARANTINED: u32 = 4;
    const AUTHORITY_STOPPING: u32 = 5;

    fn authority_state_name(state: u32) -> &'static str {
        match state {
            AUTHORITY_STARTING => "STARTING",
            AUTHORITY_VERIFYING => "VERIFYING",
            AUTHORITY_READY => "READY",
            AUTHORITY_RECOVERY_REQUIRED => "RECOVERY_REQUIRED",
            AUTHORITY_QUARANTINED => "QUARANTINED",
            AUTHORITY_STOPPING => "STOPPING",
            _ => "QUARANTINED",
        }
    }

    fn set_authority_state(state: u32) {
        CURRENT_AUTHORITY_STATE.store(state, Ordering::SeqCst);
    }
    static CONFIG: OnceLock<Config> = OnceLock::new();
    #[derive(Clone)]
    struct Config {
        service_name: String,
        data_dir: PathBuf,
        client_sid: String,
        #[cfg(feature = "synthetic-maintenance")]
        synthetic_maintenance_client_sid: Option<String>,
    }
    fn valid_sid_text(value: &str) -> bool {
        let parts: Vec<_> = value.split('-').collect();
        if parts.len() < 4 || parts.len() > 18 || parts[0] != "S" || parts[1] != "1" {
            return false;
        }
        if parts[2]
            .parse::<u64>()
            .map_or(true, |authority| authority > 0x0000_ffff_ffff_ffff)
        {
            return false;
        }
        parts[3..].iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && part.parse::<u32>().is_ok()
        })
    }
    fn set_status(state: DWORD, exit_code: DWORD) {
        CURRENT_SERVICE_STATE.store(state, Ordering::SeqCst);
        let handle = STATUS_HANDLE.load(Ordering::SeqCst);
        if handle == SERVICE_STATUS_HANDLE_INVALID {
            return;
        }
        let status = SERVICE_STATUS {
            dwServiceType: SERVICE_WIN32_OWN_PROCESS,
            dwCurrentState: state,
            dwControlsAccepted: if state == SERVICE_RUNNING {
                SERVICE_ACCEPT_STOP
            } else {
                0
            },
            dwWin32ExitCode: exit_code,
            dwServiceSpecificExitCode: 0,
            dwCheckPoint: 0,
            dwWaitHint: 5000,
        };
        unsafe {
            SetServiceStatus(handle, &status);
        }
    }
    pub fn stopping() -> bool {
        STOP.load(Ordering::SeqCst)
    }
    pub fn operation_guard() -> std::sync::MutexGuard<'static, ()> {
        AUTHORITY_OPERATION_GATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
    #[cfg(feature = "synthetic-maintenance")]
    pub fn synthetic_operation_guard() -> std::sync::MutexGuard<'static, ()> {
        SYNTHETIC_OPERATION_GATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
    fn withdraw_readiness_on_stop() -> Result<(), String> {
        let path = READINESS_PATH
            .get()
            .ok_or("READINESS_PATH_NOT_INITIALIZED")?;
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("READINESS_STOP_WITHDRAWAL_FAILED:{error}")),
        }
    }
    fn remove_stale_readiness(cfg: &Config) -> Result<(), String> {
        match std::fs::remove_file(cfg.data_dir.join("broker-ready.json")) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("STALE_READINESS_REMOVE_FAILED:{error}")),
        }
    }
    fn start_nonce() -> String {
        let process_id = unsafe { GetCurrentProcessId() };
        let monotonic = unsafe { GetTickCount64() };
        let wall_clock = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or_default();
        format!("{process_id:x}-{monotonic:x}-{wall_clock:x}")
    }
    fn publish_readiness(cfg: &Config, nonce: &str) -> Result<(), String> {
        let path = cfg.data_dir.join("broker-ready.json");
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|error| format!("READINESS_CREATE_NEW:{error}"))?;
        let record = format!(
            "{{\"schema\":\"SYLPH_G1_BROKER_READY_4\",\"serviceState\":\"READY\",\"authorityState\":{},\"authorityClass\":\"SYNTHETIC_TEST_ONLY\",\"ready\":true,\"serviceName\":{},\"pipe\":{},\"processId\":{},\"startupNonce\":{},\"firstPipeInstanceCreated\":true}}\n",
            json_string(authority_state_name(CURRENT_AUTHORITY_STATE.load(Ordering::SeqCst))),
            json_string(&cfg.service_name),
            json_string(pipe::PIPE_NAME),
            unsafe { GetCurrentProcessId() },
            json_string(nonce),
        );
        file.write_all(record.as_bytes())
            .map_err(|error| format!("READINESS_WRITE:{error}"))?;
        file.sync_all()
            .map_err(|error| format!("READINESS_SYNC:{error}"))?;
        Ok(())
    }
    unsafe extern "system" fn handler(
        control: DWORD,
        _event_type: DWORD,
        _event_data: *mut c_void,
        _context: *mut c_void,
    ) -> DWORD {
        match control {
            SERVICE_CONTROL_STOP => {
                // Serialize shutdown against an already admitted operation.
                // Dispatch holds this gate through its response write, whose
                // timeout is bounded. No new operation can pass after STOP.
                let _operation = operation_guard();
                #[cfg(feature = "synthetic-maintenance")]
                let _synthetic_operation = synthetic_operation_guard();
                STOP.store(true, Ordering::SeqCst);
                set_authority_state(AUTHORITY_STOPPING);
                if let Err(error) = withdraw_readiness_on_stop() {
                    *READINESS_WITHDRAWAL_ERROR
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(error);
                }
                set_status(SERVICE_STOP_PENDING, 0);
                0
            }
            SERVICE_CONTROL_INTERROGATE => {
                let state = CURRENT_SERVICE_STATE.load(Ordering::SeqCst);
                set_status(state, 0);
                0
            }
            _ => 1,
        }
    }
    unsafe extern "system" fn service_main(_argc: DWORD, _argv: *mut *mut u16) {
        let cfg = match CONFIG.get() {
            Some(c) => c.clone(),
            None => {
                return;
            }
        };
        let name = wide(&cfg.service_name);
        let handle = RegisterServiceCtrlHandlerExW(name.as_ptr(), Some(handler), null_mut());
        if handle == 0 {
            return;
        }
        STATUS_HANDLE.store(handle, Ordering::SeqCst);
        set_status(SERVICE_START_PENDING, 0);
        set_authority_state(AUTHORITY_STARTING);
        let _ = std::fs::remove_file(cfg.data_dir.join("broker-startup-error.txt"));
        let mut result = run_service(&cfg);
        if let Some(error) = READINESS_WITHDRAWAL_ERROR
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
        {
            result = Err(error);
        }
        if stopping() {
            set_authority_state(AUTHORITY_STOPPING);
        } else if result.is_err() {
            set_authority_state(AUTHORITY_QUARANTINED);
        }
        if let Err(error) = remove_stale_readiness(&cfg) {
            result = Err(format!("READINESS_WITHDRAWAL_FAILED:{error}"));
        }
        match result {
            Ok(()) => set_status(SERVICE_STOPPED, 0),
            Err(error) => {
                let _ = std::fs::write(
                    cfg.data_dir.join("broker-startup-error.txt"),
                    error.as_bytes(),
                );
                set_status(SERVICE_STOPPED, 1066);
            }
        }
    }
    fn parse_args() -> Result<Config, String> {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut service_name = None;
        let mut data_dir = None;
        let mut client_sid = None;
        #[cfg(feature = "synthetic-maintenance")]
        let mut synthetic_maintenance_client_sid = None;
        let mut i = 0;
        while i < args.len() {
            match args[i].as_str() {
                "--service-name" => {
                    i += 1;
                    service_name = args.get(i).cloned();
                }
                "--data-dir" => {
                    i += 1;
                    data_dir = args.get(i).map(PathBuf::from);
                }
                "--client-sid" => {
                    i += 1;
                    client_sid = args.get(i).cloned();
                }
                #[cfg(feature = "synthetic-maintenance")]
                "--synthetic-maintenance-client-sid" => {
                    i += 1;
                    synthetic_maintenance_client_sid = args.get(i).cloned();
                }
                "--help" => return Err("Service-only executable; configure via SCM".into()),
                other => return Err(format!("UNKNOWN_ARGUMENT:{other}")),
            }
            i += 1;
        }
        let service_name = service_name.ok_or("SERVICE_NAME_REQUIRED")?;
        if service_name.len() > 128
            || !service_name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Err("SERVICE_NAME_INVALID".into());
        }
        let data_dir = data_dir.ok_or("DATA_DIRECTORY_REQUIRED")?;
        if !data_dir.is_absolute() {
            return Err("DATA_DIRECTORY_MUST_BE_ABSOLUTE".into());
        }
        let client_sid = client_sid.ok_or("CLIENT_SID_REQUIRED")?;
        if client_sid.len() > 184 || !valid_sid_text(&client_sid) {
            return Err("CLIENT_SID_INVALID".into());
        }
        #[cfg(feature = "synthetic-maintenance")]
        if synthetic_maintenance_client_sid
            .as_ref()
            .is_some_and(|sid| sid.len() > 184 || !valid_sid_text(sid) || sid == &client_sid)
        {
            return Err("SYNTHETIC_MAINTENANCE_CLIENT_SID_INVALID_OR_NOT_DISTINCT".into());
        }
        Ok(Config {
            service_name,
            data_dir,
            client_sid,
            #[cfg(feature = "synthetic-maintenance")]
            synthetic_maintenance_client_sid,
        })
    }
    #[cfg(feature = "synthetic-maintenance")]
    fn prepare_synthetic_store(data_dir: &std::path::Path) -> Result<PathBuf, String> {
        let data_metadata =
            std::fs::symlink_metadata(data_dir).map_err(|_| "SYNTHETIC_DATA_ROOT_UNAVAILABLE")?;
        if !data_metadata.is_dir()
            || data_metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            return Err("SYNTHETIC_DATA_ROOT_INVALID".into());
        }
        let store_dir = data_dir.join("synthetic-maintenance-data");
        match std::fs::create_dir(&store_dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(format!("SYNTHETIC_DATA_DIRECTORY_CREATE:{error}")),
        }
        let metadata = std::fs::symlink_metadata(&store_dir)
            .map_err(|_| "SYNTHETIC_DATA_DIRECTORY_UNAVAILABLE")?;
        if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("SYNTHETIC_DATA_DIRECTORY_REPARSE_POINT_REJECTED".into());
        }
        let canonical_root = std::fs::canonicalize(data_dir)
            .map_err(|_| "SYNTHETIC_DATA_ROOT_CANONICALIZE_FAILED")?;
        let canonical_store = std::fs::canonicalize(&store_dir)
            .map_err(|_| "SYNTHETIC_DATA_DIRECTORY_CANONICALIZE_FAILED")?;
        if canonical_store == canonical_root || !canonical_store.starts_with(&canonical_root) {
            return Err("SYNTHETIC_DATA_DIRECTORY_OUTSIDE_ROOT".into());
        }
        Ok(store_dir.join("synthetic-import.sqlite"))
    }
    pub fn run() -> Result<(), String> {
        let cfg = parse_args()?;
        READINESS_PATH
            .set(cfg.data_dir.join("broker-ready.json"))
            .map_err(|_| "READINESS_PATH_ALREADY_SET")?;
        *READINESS_WITHDRAWAL_ERROR
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        CONFIG.set(cfg.clone()).map_err(|_| "CONFIG_ALREADY_SET")?;
        let name = wide(&cfg.service_name);
        let table = [
            SERVICE_TABLE_ENTRYW {
                lpServiceName: name.as_ptr() as *mut u16,
                lpServiceProc: Some(service_main),
            },
            SERVICE_TABLE_ENTRYW {
                lpServiceName: null_mut(),
                lpServiceProc: None,
            },
        ];
        unsafe {
            check(
                StartServiceCtrlDispatcherW(table.as_ptr()),
                "StartServiceCtrlDispatcher",
            )?;
        }
        Ok(())
    }
    fn run_service(cfg: &Config) -> Result<(), String> {
        STOP.store(false, Ordering::SeqCst);
        set_authority_state(AUTHORITY_VERIFYING);
        remove_stale_readiness(cfg)?;
        let nonce = start_nonce();
        let service_account = format!("NT SERVICE\\{}", cfg.service_name);
        let service_sid = lookup_account_sid_text(&service_account)?;
        #[cfg(feature = "synthetic-maintenance")]
        if cfg
            .synthetic_maintenance_client_sid
            .as_deref()
            .is_some_and(|sid| sid == service_sid)
        {
            return Err("SYNTHETIC_MAINTENANCE_CLIENT_MUST_NOT_BE_SERVICE_IDENTITY".into());
        }
        let (service_sid_ptr, _service_sid_storage) = lookup_sid(&service_account)?;
        let user_sid = current_process_user_sid()?;
        let mut token = null_mut();
        unsafe {
            check(
                OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token),
                "OpenProcessToken(service-check)",
            )?;
        }
        let token_sid_check: Result<(Option<u32>, Option<u32>), String> = (|| {
            Ok((
                token_has_sid_in_list(token, 2, service_sid_ptr)?,
                token_has_sid_in_list(token, TOKEN_RESTRICTED_SIDS, service_sid_ptr)?,
            ))
        })();
        unsafe {
            close(token);
        }
        let (group_attributes, restricted_attributes) = token_sid_check?;
        let group_present = group_attributes.is_some_and(|attributes| attributes & 0x4 != 0);
        let restricted_present = restricted_attributes.is_some();
        let check_token_membership = current_process_is_member(&service_account)?;
        if !check_token_membership {
            return Err("SERVICE_SID_CHECK_TOKEN_MEMBERSHIP_FAILED".into());
        }
        let identity_mode =
            classify_service_identity(&user_sid, &service_sid, group_present, restricted_present)
                .ok_or_else(|| {
                    format!(
                        "UNSUPPORTED_SERVICE_IDENTITY:user={user_sid};expected={service_sid};groupAttributes={group_attributes:?};restrictedAttributes={restricted_attributes:?};member={check_token_membership}"
                    )
                })?;
        #[cfg(feature = "synthetic-maintenance")]
        let synthetic_client_sid = cfg.synthetic_maintenance_client_sid.as_deref();
        #[cfg(not(feature = "synthetic-maintenance"))]
        let synthetic_client_sid: Option<&str> = None;
        if synthetic_client_sid.is_some_and(|sid| sid == service_sid) {
            return Err("SYNTHETIC_MAINTENANCE_CLIENT_MUST_NOT_BE_SERVICE_IDENTITY".into());
        }
        pipe::restrict_broker_process_dacl(&service_sid, &cfg.client_sid, synthetic_client_sid)?;
        pipe::restrict_broker_token_dacl(&service_sid, &cfg.client_sid, synthetic_client_sid)?;
        let group_attributes_json =
            group_attributes.map_or("null".to_string(), |value| value.to_string());
        let restricted_attributes_json =
            restricted_attributes.map_or("null".to_string(), |value| value.to_string());
        let process_identity = process_identity_fields()?;
        if !cfg.data_dir.is_dir() {
            return Err("PROTECTED_DATA_DIRECTORY_MISSING".into());
        }
        let db_path = cfg.data_dir.join("registry.sqlite");
        let registry = sqlite::Registry::open_existing(&db_path)?;
        // This candidate has no authenticated external history or trusted
        // recovery approval. It can serve diagnostics and synthetic tests,
        // but it must never claim operational authority readiness.
        set_authority_state(AUTHORITY_RECOVERY_REQUIRED);
        let db_identity = identity::describe(db_path.to_string_lossy().as_ref())?;
        let privileges = json_privileges(&process_identity.privileges);
        let db_path_text = db_path.to_string_lossy();
        let report = format!(
            "{{\"schema\":\"SYLPH_G1_BROKER_TOKEN_2\",\"processId\":{},\"serviceName\":{},\"identityMode\":{},\"tokenUserSid\":{},\"serviceSid\":{},\"serviceSidPresent\":true,\"serviceSidMember\":{},\"serviceSidGroupPresent\":{},\"serviceSidGroupAttributes\":{},\"serviceSidInRestrictedList\":{},\"serviceSidRestrictedAttributes\":{},\"integrityRid\":{},\"privilegeCount\":{},\"enabledPrivilegeCount\":{},\"privileges\":{},\"databasePath\":{},\"databaseIdentity\":{},\"sqliteVersion\":{},\"sqliteSourceId\":{},\"pragmas\":{{\"journalMode\":{},\"synchronous\":{},\"foreignKeys\":{},\"trustedSchema\":{}}}}}\n",
            unsafe { GetCurrentProcessId() },
            json_string(&cfg.service_name),
            json_string(identity_mode),
            json_string(&user_sid),
            json_string(&service_sid),
            check_token_membership,
            group_present,
            group_attributes_json,
            restricted_present,
            restricted_attributes_json,
            process_identity.integrity_rid,
            process_identity.privilege_count,
            process_identity.enabled_privilege_count,
            privileges,
            json_string(&db_path_text),
            db_identity,
            json_string(&registry.version),
            json_string(&registry.sourceid),
            json_string(&registry.journal_mode),
            registry.synchronous,
            registry.foreign_keys,
            registry.trusted_schema,
        );
        std::fs::write(cfg.data_dir.join("broker-token.json"), report)
            .map_err(|e| format!("TOKEN_REPORT_WRITE:{e}"))?;
        #[cfg(feature = "synthetic-maintenance")]
        let synthetic_endpoint =
            if let Some(synthetic_client_sid) = cfg.synthetic_maintenance_client_sid.clone() {
                let started = prepare_synthetic_store(&cfg.data_dir).and_then(|synthetic_db| {
                    let endpoint_service_sid = service_sid.clone();
                    std::thread::Builder::new()
                        .name("g1-synthetic-maintenance-test-only".into())
                        .spawn(move || {
                            pipe::serve_synthetic_maintenance(
                                &endpoint_service_sid,
                                &synthetic_client_sid,
                                &synthetic_db,
                            )
                        })
                        .map_err(|error| format!("SYNTHETIC_ENDPOINT_THREAD_START:{error}"))
                });
                match started {
                    Ok(worker) => Some(worker),
                    Err(error) => {
                        // The opt-in test endpoint is auxiliary. Its failure is
                        // recorded but does not publish or withdraw normal
                        // service readiness and never changes registry state.
                        let _ = std::fs::write(
                            cfg.data_dir.join("synthetic-maintenance-status.txt"),
                            format!("DISABLED:{error}"),
                        );
                        None
                    }
                }
            } else {
                None
            };
        let mut on_pipe_created = || {
            publish_readiness(cfg, &nonce)?;
            set_status(SERVICE_RUNNING, 0);
            Ok(())
        };
        let normal_result = pipe::serve(
            &service_sid,
            &cfg.client_sid,
            &registry,
            &mut on_pipe_created,
        );
        #[cfg(feature = "synthetic-maintenance")]
        if let Some(worker) = synthetic_endpoint {
            if normal_result.is_err() {
                // Stop and drain the test-only endpoint before the service
                // returns from a fatal normal-pipe error.
                STOP.store(true, Ordering::SeqCst);
            }
            let endpoint_result = worker
                .join()
                .map_err(|_| "SYNTHETIC_ENDPOINT_THREAD_PANICKED")?;
            if let Err(error) = &endpoint_result {
                let _ = std::fs::write(
                    cfg.data_dir.join("synthetic-maintenance-status.txt"),
                    format!("DISABLED:{error}"),
                );
            }
            if !stopping() {
                endpoint_result?;
            }
        }
        normal_result?;
        if registry.check_integrity()? != "ok" {
            return Err("SQLITE_INTEGRITY_FAILED_AT_SHUTDOWN".into());
        }
        Ok(())
    }

    #[cfg(all(test, feature = "synthetic-maintenance"))]
    mod synthetic_store_path_tests {
        use super::{prepare_synthetic_store, valid_sid_text};
        use std::os::windows::fs::MetadataExt;
        use std::process::Command;
        use std::time::{SystemTime, UNIX_EPOCH};

        fn scratch() -> std::path::PathBuf {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            std::env::temp_dir().join(format!("g1-maint-reparse-{}-{nonce}", std::process::id()))
        }

        struct ScratchCleanup(std::path::PathBuf);
        impl Drop for ScratchCleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        struct ListenerGuard(Option<std::thread::JoinHandle<Result<(), String>>>);
        impl ListenerGuard {
            fn stop(mut self) -> Result<(), String> {
                super::STOP.store(true, std::sync::atomic::Ordering::SeqCst);
                let joined = self.0.take().expect("listener handle present").join();
                super::STOP.store(false, std::sync::atomic::Ordering::SeqCst);
                joined.map_err(|_| "PIPE_LISTENER_THREAD_PANICKED".to_owned())?
            }
        }
        impl Drop for ListenerGuard {
            fn drop(&mut self) {
                if let Some(listener) = self.0.take() {
                    super::STOP.store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = listener.join();
                    super::STOP.store(false, std::sync::atomic::Ordering::SeqCst);
                }
            }
        }

        #[test]
        fn maintenance_sid_text_is_strictly_validated() {
            assert!(valid_sid_text("S-1-5-21-123-456-789-1001"));
            assert!(valid_sid_text("S-1-5-80-101-202-303-404-505"));
            assert!(!valid_sid_text("S-1-"));
            assert!(!valid_sid_text("S-1-5-abc"));
            assert!(!valid_sid_text("S-1-281474976710656-1"));
            assert!(!valid_sid_text(
                "S-1-5-1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16"
            ));
        }

        #[test]
        fn rejects_junction_store_directory_without_touching_target() {
            let root = scratch();
            let _cleanup = ScratchCleanup(root.clone());
            let outside = root.join("outside");
            let data = root.join("data");
            let store_link = data.join("synthetic-maintenance-data");
            std::fs::create_dir_all(&outside).unwrap();
            std::fs::create_dir_all(&data).unwrap();
            let sentinel = outside.join("sentinel.txt");
            std::fs::write(&sentinel, b"unchanged").unwrap();
            let output = Command::new("cmd.exe")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(&store_link)
                .arg(&outside)
                .output()
                .expect("Windows cmd.exe must be available for junction negative test");
            assert!(
                output.status.success(),
                "junction setup failed; this is not a pass: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let metadata = std::fs::symlink_metadata(&store_link).unwrap();
            assert_ne!(metadata.file_attributes() & 0x0000_0400, 0);
            let error = prepare_synthetic_store(&data).unwrap_err();
            assert_eq!(error, "SYNTHETIC_DATA_DIRECTORY_REPARSE_POINT_REJECTED");
            assert_eq!(std::fs::read(&sentinel).unwrap(), b"unchanged");
            std::fs::remove_dir(&store_link).unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }

        fn put_u32(out: &mut Vec<u8>, value: u32) {
            out.extend_from_slice(&value.to_be_bytes());
        }
        fn put_u64(out: &mut Vec<u8>, value: u64) {
            out.extend_from_slice(&value.to_be_bytes());
        }
        fn put_bytes(out: &mut Vec<u8>, value: &[u8]) {
            put_u32(out, value.len() as u32);
            out.extend_from_slice(value);
        }
        fn put_str(out: &mut Vec<u8>, value: &str) {
            put_bytes(out, value.as_bytes());
        }
        fn put_anchor(out: &mut Vec<u8>, generation: u64, root: &str, receipt: &str) {
            put_str(out, "scratch-chain");
            put_u64(out, generation);
            put_str(out, root);
            put_str(out, receipt);
            put_u32(out, 0);
        }
        fn valid_request() -> Vec<u8> {
            let id = [0x31u8; 16];
            let mut bundle = crate::import::ImportBundle {
                schema: 1,
                chain_identity: "scratch-chain".into(),
                generation: 2,
                parent_generation: 1,
                parent_state_root: "state-1".into(),
                state_root: String::new(),
                receipts: vec![crate::import::ReceiptRecord {
                    identity: "receipt-2".into(),
                    parent_identity: "receipt-1".into(),
                    payload: b"synthetic fixture payload".to_vec(),
                }],
                obligations: vec![],
                evidence_envelope: {
                    let mut envelope = b"SYLPH_G1_SYNTHETIC_TEST_ONLY_V1\0".to_vec();
                    envelope.extend_from_slice(&id);
                    envelope
                },
            };
            bundle.state_root = crate::import::state_root(&bundle).unwrap();

            let mut out = b"G1SIMP01".to_vec();
            out.extend_from_slice(&id);
            put_anchor(&mut out, 1, "state-1", "receipt-1");
            put_anchor(&mut out, 1, "state-1", "receipt-1");
            put_u32(&mut out, bundle.schema);
            put_str(&mut out, &bundle.chain_identity);
            put_u64(&mut out, bundle.generation);
            put_u64(&mut out, bundle.parent_generation);
            put_str(&mut out, &bundle.parent_state_root);
            put_str(&mut out, &bundle.state_root);
            put_u32(&mut out, bundle.receipts.len() as u32);
            for receipt in &bundle.receipts {
                put_str(&mut out, &receipt.identity);
                put_str(&mut out, &receipt.parent_identity);
                put_bytes(&mut out, &receipt.payload);
            }
            put_u32(&mut out, bundle.obligations.len() as u32);
            put_bytes(&mut out, &bundle.evidence_envelope);
            out
        }
        fn related_files(path: &std::path::Path) -> Vec<(std::path::PathBuf, Option<Vec<u8>>)> {
            ["", "-wal", "-shm", "-journal"]
                .into_iter()
                .map(|suffix| {
                    let mut name = path.as_os_str().to_os_string();
                    name.push(suffix);
                    let path = std::path::PathBuf::from(name);
                    let contents = std::fs::read(&path).ok();
                    (path, contents)
                })
                .collect()
        }

        #[test]
        fn named_pipe_endpoint_is_synthetic_and_does_not_touch_normal_state() {
            super::STOP.store(false, std::sync::atomic::Ordering::SeqCst);
            let root = scratch();
            let _cleanup = ScratchCleanup(root.clone());
            let data = root.join("data");
            std::fs::create_dir_all(&data).unwrap();
            let registry_path = data.join("registry.sqlite");
            drop(crate::win::sqlite::Registry::initialize(&registry_path).unwrap());
            let ready_path = data.join("broker-ready.json");
            std::fs::write(&ready_path, b"normal-readiness-sentinel").unwrap();
            let readiness_before = std::fs::read(&ready_path).unwrap();
            let registry_before = related_files(&registry_path);
            let synthetic_store = prepare_synthetic_store(&data).unwrap();
            let client_sid = crate::win::current_process_user_sid().unwrap();
            let server_sid = "S-1-5-80-101-202-303-404-505".to_owned();
            assert_ne!(client_sid, server_sid);
            let server_store = synthetic_store.clone();
            let server_sid_for_thread = server_sid.clone();
            let client_sid_for_thread = client_sid.clone();
            let (ready_sender, ready_receiver) = std::sync::mpsc::channel();
            let listener = ListenerGuard(Some(std::thread::spawn(move || {
                let mut ready_sender = Some(ready_sender);
                let mut on_pipe_created = || {
                    if let Some(sender) = ready_sender.take() {
                        let _ = sender.send(Ok(()));
                    }
                    Ok(())
                };
                let result = crate::win::pipe::serve_synthetic_maintenance_with_callback(
                    &server_sid_for_thread,
                    &client_sid_for_thread,
                    &server_store,
                    &mut on_pipe_created,
                );
                if let Some(sender) = ready_sender {
                    let message = result
                        .as_ref()
                        .err()
                        .cloned()
                        .unwrap_or_else(|| "PIPE_ENDPOINT_EXITED_BEFORE_READY".into());
                    let _ = sender.send(Err(message));
                }
                result
            })));

            match ready_receiver.recv_timeout(std::time::Duration::from_secs(5)) {
                Ok(Ok(())) => {}
                Ok(Err(error)) => panic!("synthetic pipe listener startup failed: {error}"),
                Err(error) => {
                    let result = listener.stop();
                    panic!("synthetic pipe listener startup was not reported: {error}; result={result:?}");
                }
            }

            let accepted =
                crate::win::pipe::synthetic_maintenance_exchange(&valid_request(), false)
                    .expect("named pipe roundtrip must reach the endpoint");
            assert!(accepted.contains("\"authority\":\"SYNTHETIC_TEST_ONLY\""));
            assert!(
                accepted.contains("\"result\":\"ACTIVATED\""),
                "unexpected synthetic import response: {accepted}"
            );
            let rejected = crate::win::pipe::synthetic_maintenance_exchange(b"RESET", false)
                .expect("malformed request should receive a rejection");
            assert!(rejected.contains("\"result\":\"REJECTED\""));

            assert!(synthetic_store.exists());
            assert!(!data.join("registry.sqlite-journal").exists());
            assert_eq!(std::fs::read(&ready_path).unwrap(), readiness_before);
            assert_eq!(related_files(&registry_path), registry_before);

            let stopped = listener.stop();
            assert!(stopped.is_ok(), "listener shutdown result: {stopped:?}");
        }
    }
}

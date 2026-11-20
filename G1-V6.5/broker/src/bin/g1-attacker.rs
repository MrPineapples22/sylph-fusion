#[path = "../win.rs"]
mod win;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.as_slice() {
        [op, path] if op == "write" => win::attack::write_one_byte(path),
        [op, path] if op == "write-only" => win::attack::write_only_one_byte(path),
        [op, path] if op == "read" => win::attack::open_read_only(path),
        [op, path] if op == "pipe-instance" => win::attack::try_create_pipe_instance(path),
        [op, path, mask] if op == "pipe-acl-probe" => win::pipe::probe_client_acl(path, mask),
        [op] if op == "pipe-disconnect" => win::pipe::disconnect_without_frame(),
        [op, path] if op == "pipe-instance-control" => {
            win::attack::pipe_instance_positive_control(path)
        }
        [op, ready, release] if op == "pipe-server-hold" => {
            win::attack::hold_fake_pipe_server(ready, release)
        }
        [op] if op == "identity" => win::process_identity_json(),
        [op] if op == "forbidden" => win::pipe::client_command(&["forbidden".into()]),
        _ => Err(
            "usage: g1-attacker identity | read <synthetic-db> | write <synthetic-db> | write-only <synthetic-db> | pipe-instance <pipe-name> | pipe-acl-probe <pipe-name> <mask-hex> | pipe-instance-control <pipe-name> | pipe-disconnect | pipe-server-hold <ready-file> <release-file> | forbidden".into(),
        ),
    };
    match result {
        Ok(value) => {
            println!("{value}");
            if value.contains("\"result\":\"WRITE_SUCCEEDED\"")
                || value.contains("\"result\":\"ACCESS_DENIED\"")
                || value.contains("SYLPH_G1_READ_ATTACK_1")
                || value.contains("SYLPH_G1_PIPE_INSTANCE_ATTACK_1")
                || value.contains("SYLPH_G1_PIPE_ACL_PROBE_1")
                || value.contains("SYLPH_G1_PIPE_INSTANCE_CONTROL_1")
                || value.contains("SYLPH_G1_PIPE_DISCONNECT_1")
                || value.contains("SYLPH_G1_PIPE_HOLD_1")
                || value.contains("SYLPH_G1_PROCESS_IDENTITY_2")
                || value.starts_with("ERR|FORBIDDEN_OPERATION")
            {
                return;
            }
            std::process::exit(2);
        }
        Err(error) => {
            eprintln!("ATTACK_ERROR: {error}");
            std::process::exit(1);
        }
    }
}

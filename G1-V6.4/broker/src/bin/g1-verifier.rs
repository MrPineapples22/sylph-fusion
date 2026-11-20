#[path = "../win.rs"]
mod win;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.as_slice() {
        [op, path] if op == "identity" => win::identity::describe(path),
        [op] if op == "process" => win::process_identity_json(),
        [op, path] if op == "sqlite" => win::sqlite::inspect_readonly(std::path::Path::new(path)),
        [op, left, right] if op == "same" => win::identity::compare(left, right, true),
        [op, left, right] if op == "different" => win::identity::compare(left, right, false),
        _ => Err("usage: g1-verifier process | identity <path> | sqlite <path> | same <a> <b> | different <a> <b>".into()),
    };
    match result {
        Ok(text) => println!("{text}"),
        Err(error) => {
            eprintln!("VERIFY_ERROR: {error}");
            std::process::exit(1);
        }
    }
}

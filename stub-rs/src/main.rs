use std::env;
use std::process::exit;
use std::process::Command;
use std::time::Duration;

use reqwest::{Client, Url};
use serde::Deserialize;

#[derive(Deserialize)]
struct ResponseData {
    text: Option<String>,
    code: i32,
    error: Option<String>,
}

fn is_youtube(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else { return false };
    if !matches!(url.scheme(), "http" | "https") { return false; }
    let Some(host) = url.host_str() else { return false };
    host == "youtu.be" || host == "youtube.com" || host.ends_with(".youtube.com")
        || host == "www.youtube-nocookie.com"
}

fn fallback(args: &[String]) -> Result<i32, Box<dyn std::error::Error>> {
    let original = env::current_exe()?.with_file_name("yt-dlp-original.exe");
    let status = Command::new(original).args(args).status()?;
    Ok(status.code().unwrap_or(1))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();

    let Some(video_url) = args.iter().rev().find(|value| is_youtube(value)) else {
        exit(fallback(&args)?);
    };

    // The loopback relay must not go through a user's system or environment proxy.
    let client = Client::builder().no_proxy().timeout(Duration::from_secs(75)).build()?;
    let res = client
        .post("http://127.0.0.1:7919/fetch-link")
        .json(&serde_json::json!({
            "url": video_url,
        }))
        .send()
        .await?;

    let data: ResponseData = res.error_for_status()?.json().await?;

    if let Some(text) = data.text {
        println!("{}", text);
    }
    if let Some(error) = data.error { eprintln!("{}", error); }

    exit(data.code);
}

#[cfg(test)]
mod tests {
    use super::is_youtube;

    #[test]
    fn recognizes_shared_links_without_substring_spoofing() {
        assert!(is_youtube("https://youtu.be/-PTe8zkYt9A?t=1"));
        assert!(is_youtube("https://m.youtube.com/shorts/-PTe8zkYt9A"));
        assert!(is_youtube("https://www.youtube.com/watch?v=-PTe8zkYt9A"));
        assert!(!is_youtube("https://youtube.com.example.org/video"));
        assert!(!is_youtube("https://example.org/?url=youtube.com"));
        assert!(!is_youtube("file://youtube.com/video"));
    }
}

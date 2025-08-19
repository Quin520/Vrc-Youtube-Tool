use std::env;
use std::process::exit;

use reqwest::Client;
use serde::Deserialize;

#[derive(Deserialize)]
struct ResponseData {
    text: Option<String>,
    code: i32,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();

    // 找到最后一个参数，或者任意一个 http 开头的
    let mut video_url = args.last().cloned();
    if let Some(url) = &video_url {
        if !url.starts_with("http") {
            video_url = args.iter().find(|it| it.starts_with("http")).cloned();
        }
    }
    else {
        video_url = args.iter().find(|it| it.starts_with("http")).cloned();
    }

    if video_url.is_none() {
        exit(1);
    }

    let video_url = video_url.unwrap();
    if !video_url.contains("youtube.") {
        exit(1);
    }

    let client = Client::new();
    let res = client
        .post("http://127.0.0.1:7919/fetch-link")
        .json(&serde_json::json!({
            "args": args,
        }))
        .send()
        .await?;

    let data: ResponseData = res.json().await?;

    if let Some(text) = data.text {
        println!("{}", text);
    }

    exit(data.code);
}

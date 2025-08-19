const args = Bun.argv.slice(2);

let videoUrl = args[args.length - 1];
if (!videoUrl?.startsWith('http')) {
  videoUrl = args.find(it => it.startsWith('http'));
}
if (!videoUrl) {
  process.exit(1);
}
if(!videoUrl.includes('youtube.')) {
  process.exit(1);
}

const res = await fetch('http://127.0.0.1:7919/fetch-link', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    args: args,
  }),
})

const data = await res.json() as {
  text?: string;
  code: number;
};

if (data.text) {
  console.log(data.text);
}

process.exit(data.code);

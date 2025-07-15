// メインBotを起動するためのシンプルなスクリプト
require('dotenv').config({ path: './env/.env' });
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const util = require('util');
const config = require('./env/config');

console.log('GCP Service Account Key Path:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
console.log('トークン:', config.token ? '設定されています' : '設定されていません');
console.log('APPLICATION_ID:', config.applicationId ? '設定されています' : '設定されていません');

// クライアントの設定
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

// コマンド定義
const commands = [
  new SlashCommandBuilder()
    .setName('hello')
    .setDescription('こんにちはと返事します')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('speed')
    .setDescription('読み上げ速度を設定します')
    .addNumberOption(option =>
      option.setName('rate')
        .setDescription('読み上げ速度 (0.25～4.0の間、標準は1.0)')
        .setRequired(true)
        .setMinValue(0.25)
        .setMaxValue(4.0))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('listen')
    .setDescription('チャンネルのメッセージを読み上げます')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('読み上げ対象のテキストチャンネル')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('language')
        .setDescription('読み上げ言語')
        .setRequired(false)
        .addChoices(
          { name: '日本語', value: 'ja-JP' },
          { name: '英語', value: 'en-US' },
          { name: '中国語', value: 'zh-CN' },
          { name: '韓国語', value: 'ko-KR' }
        ))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('チャンネルの読み上げを停止します')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('読み上げを停止するチャンネル')
        .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('speak')
    .setDescription('選択したメッセージを音声で読み上げます')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('読み上げるメッセージ')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('language')
        .setDescription('読み上げる言語')
        .setRequired(false)
        .addChoices(
          { name: '日本語', value: 'ja-JP' },
          { name: '英語', value: 'en-US' },
          { name: '中国語', value: 'zh-CN' },
          { name: '韓国語', value: 'ko-KR' }
        ))
    .toJSON(),
  // 日本語用
  new ContextMenuCommandBuilder()
    .setName('日本語で読み上げる')
    .setType(ApplicationCommandType.Message)
    .toJSON(),
  // 英語用
  new ContextMenuCommandBuilder()
    .setName('英語で読み上げる')
    .setType(ApplicationCommandType.Message)
    .toJSON(),
  // 中国語用
  new ContextMenuCommandBuilder()
    .setName('中国語で読み上げる')
    .setType(ApplicationCommandType.Message)
    .toJSON(),
  // 韓国語用
  new ContextMenuCommandBuilder()
    .setName('韓国語で読み上げる')
    .setType(ApplicationCommandType.Message)
    .toJSON(),
];

// Google Cloud Text-to-Speech クライアントを作成
const ttsClient = new textToSpeech.TextToSpeechClient();

// デフォルトの読み上げ速度
let defaultSpeakingRate = 1.0; // 1.0が標準速度

// 読み上げ対象のチャンネルを管理するオブジェクト
const activeChannels = {};

// 読み上げ言語のデフォルト設定
const defaultLanguages = {};

// 音声ファイルを生成する関数
async function generateSpeech(text, language = 'ja-JP', speakingRate = defaultSpeakingRate) {
  const request = {
    input: { text },
    voice: { languageCode: language, ssmlGender: 'NEUTRAL' },
    audioConfig: { 
      audioEncoding: 'MP3',
      speakingRate: speakingRate // 読み上げ速度を設定
    },
  };

  try {
    const [response] = await ttsClient.synthesizeSpeech(request);
    const writeFile = util.promisify(fs.writeFile);
    await writeFile('output.mp3', response.audioContent, 'binary');
    console.log('音声ファイルが生成されました');
    return true;
  } catch (error) {
    console.error('音声生成エラー:', error);
    return false;
  }
}

// 音声を再生する関数
function playAudio(interaction) {
  try {
    // ユーザーがボイスチャンネルにいるか確認
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.followUp('ボイスチャンネルに接続してください');
    }

    // ボイスチャンネルに接続
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    // オーディオプレーヤーを作成
    const player = createAudioPlayer();
    connection.subscribe(player);

    // 音声ファイルを再生
    const resource = createAudioResource('./output.mp3');
    player.play(resource);

    // 再生終了時の処理
    player.on(AudioPlayerStatus.Idle, () => {
      connection.destroy();
      interaction.followUp('読み上げが完了しました');
    });

    player.on('error', error => {
      console.error('再生エラー:', error);
      connection.destroy();
      interaction.followUp('音声の再生中にエラーが発生しました');
    });

    return true;
  } catch (error) {
    console.error('音声再生エラー:', error);
    return false;
  }
}

// 言語コードから言語名を取得するヘルパー関数
function getLanguageName(languageCode) {
  const languageMap = {
    'ja-JP': '日本語',
    'en-US': '英語',
    'zh-CN': '中国語',
    'ko-KR': '韓国語'
  };
  
  return languageMap[languageCode] || languageCode;
}

// イベントハンドラ
client.once('ready', async () => {
  console.log(`ログイン成功！ ${client.user.tag} として接続しました`);
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    console.log('コマンドを登録しています...');
    for (const guild of config.guilds) {
      await rest.put(
        Routes.applicationGuildCommands(config.applicationId, guild.id),
        { body: commands }
      );
      console.log(`コマンドを登録しました: ${guild.name} (${guild.id})`);
    }
    console.log('すべてのコマンドが正常に登録されました');
  } catch (error) {
    console.error('コマンド登録エラー:', error);
  }
});

// メッセージ作成イベントを監視
client.on('messageCreate', async message => {
  // Botのメッセージは無視
  if (message.author.bot) return;
  
  // チャンネルが監視リストにあるか確認
  if (!activeChannels[message.channelId]) return;
  
  // メッセージの内容が空でないか確認
  if (!message.content || message.content.trim() === '') return;
  
  try {
    // 言語を取得
    const language = defaultLanguages[message.channelId] || 'ja-JP';
    
    // 音声ファイルを生成
    const success = await generateSpeech(message.content, language, defaultSpeakingRate);
    if (!success) {
      console.error('音声の生成に失敗しました');
      return;
    }
    
    // メッセージが送信されたサーバーの情報を取得
    const guild = message.guild;
    if (!guild) return;
    
    // メッセージを送信したユーザーの情報を取得
    const member = await guild.members.fetch(message.author.id);
    if (!member) return;
    
    // ユーザーが接続しているボイスチャンネルを取得
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) return;
    
    // ボイスチャンネルに接続
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    
    // オーディオプレーヤーを作成
    const player = createAudioPlayer();
    connection.subscribe(player);
    
    // 音声ファイルを再生
    const resource = createAudioResource('./output.mp3');
    player.play(resource);
    
    // 再生終了時の処理
    player.on(AudioPlayerStatus.Idle, () => {
      connection.destroy();
    });
    
    player.on('error', error => {
      console.error('再生エラー:', error);
      connection.destroy();
    });
  } catch (error) {
    console.error('メッセージ読み上げエラー:', error);
  }
});

client.on('interactionCreate', async interaction => {
  // スラッシュコマンドの処理
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'hello') {
      await interaction.reply('こんにちは');
    }
    
    if (interaction.commandName === 'speed') {
      const rate = interaction.options.getNumber('rate');
      
      // 範囲外の値をチェック
      if (rate < 0.25 || rate > 4.0) {
        return interaction.reply({ content: '速度は0.25～4.0の間で指定してください。', ephemeral: true });
      }
      
      // デフォルトの読み上げ速度を更新
      defaultSpeakingRate = rate;
      
      await interaction.reply({ content: `読み上げ速度を${rate}倍に設定しました。`, ephemeral: true });
    }
    
    if (interaction.commandName === 'listen') {
      const channel = interaction.options.getChannel('channel');
      const language = interaction.options.getString('language') || 'ja-JP';
      
      // チャンネルがテキストチャンネルか確認
      if (channel.type !== 0) { // 0 = GUILD_TEXT
        return interaction.reply({ content: 'テキストチャンネルを選択してください。', ephemeral: true });
      }
      
      // ユーザーがボイスチャンネルに接続しているか確認
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '読み上げを開始するにはボイスチャンネルに接続してください。', ephemeral: true });
      }
      
      // 既に監視中の場合は言語を更新
      if (activeChannels[channel.id]) {
        defaultLanguages[channel.id] = language;
        return interaction.reply({ content: `${channel.name} の読み上げ言語を${getLanguageName(language)}に更新しました。`, ephemeral: true });
      }
      
      // チャンネルを監視リストに追加
      activeChannels[channel.id] = true;
      defaultLanguages[channel.id] = language;
      
      await interaction.reply({ content: `${channel.name} のメッセージを${getLanguageName(language)}で読み上げます。`, ephemeral: false });
    }
    
    if (interaction.commandName === 'stop') {
      const channel = interaction.options.getChannel('channel');
      
      // 監視していない場合
      if (!activeChannels[channel.id]) {
        return interaction.reply({ content: `${channel.name} は現在読み上げていません。`, ephemeral: true });
      }
      
      // 監視リストから削除
      delete activeChannels[channel.id];
      delete defaultLanguages[channel.id];
      
      await interaction.reply({ content: `${channel.name} の読み上げを停止しました。`, ephemeral: false });
    }
    
    if (interaction.commandName === 'speak') {
      await interaction.deferReply();
      
      const message = interaction.options.getString('message');
      const language = interaction.options.getString('language') || 'ja-JP';
      
      try {
        // 音声ファイルを生成
        const success = await generateSpeech(message, language, defaultSpeakingRate);
        if (!success) {
          return interaction.followUp('音声の生成に失敗しました');
        }
        
        // 音声を再生
        await interaction.followUp(`「${message}」を読み上げています...`);
        playAudio(interaction);
      } catch (error) {
        console.error('エラー:', error);
        await interaction.followUp('エラーが発生しました');
      }
    }
  }
  
  // コンテキストメニューコマンドの処理
  if (interaction.isMessageContextMenuCommand()) {
    // 選択されたメッセージのコンテンツを取得
    const selectedMessage = interaction.targetMessage;
    const messageContent = selectedMessage.content;
    
    if (!messageContent || messageContent.trim() === '') {
      return interaction.reply({ content: '読み上げるテキストがありません。画像や埋め込みのみのメッセージは読み上げられません。', ephemeral: true });
    }
    
    // コマンド名から言語コードを取得
    let languageCode = 'ja-JP'; // デフォルトは日本語
    
    if (interaction.commandName === '日本語で読み上げる') {
      languageCode = 'ja-JP';
    } else if (interaction.commandName === '英語で読み上げる') {
      languageCode = 'en-US';
    } else if (interaction.commandName === '中国語で読み上げる') {
      languageCode = 'zh-CN';
    } else if (interaction.commandName === '韓国語で読み上げる') {
      languageCode = 'ko-KR';
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // 選択された言語で音声を生成
      const success = await generateSpeech(messageContent, languageCode, defaultSpeakingRate);
      if (!success) {
        return interaction.followUp({ content: '音声の生成に失敗しました', ephemeral: true });
      }
      
      // 音声を再生
      await interaction.followUp({ content: `選択されたメッセージを${getLanguageName(languageCode)}で読み上げています...`, ephemeral: true });
      
      // インタラクションを使って音声を再生
      playAudio(interaction);
    } catch (error) {
      console.error('エラー:', error);
      await interaction.followUp({ content: 'エラーが発生しました', ephemeral: true });
    }
  }
});

// エラーハンドリング
process.on('unhandledRejection', error => {
  console.error('未処理のエラー:', error);
});

// ログイン
console.log('ログインを試行します...');
client.login(config.token).then(() => {
  console.log('ログイン処理が完了しました');
}).catch(error => {
  console.error('ログインエラー:', error);
});

console.log('プログラムは実行中です。Ctrl+Cで終了してください。');

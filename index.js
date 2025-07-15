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
    .setName('volume')
    .setDescription('音量を設定します')
    .addNumberOption(option =>
      option.setName('level')
        .setDescription('音量レベル (0.1～2.0の間、標準は1.0)')
        .setRequired(true)
        .setMinValue(0.1)
        .setMaxValue(2.0))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('現在の設定（速度と音量）を表示します')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('listen')
    .setDescription('チャンネルのメッセージを読み上げます')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('読み上げ対象のテキストチャンネル')
        .setRequired(true))
    .addChannelOption(option =>
      option.setName('voicechannel')
        .setDescription('接続するボイスチャンネル')
        .setRequired(false))
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

// デフォルトの音量
let defaultVolume = 1.0; // 1.0が標準音量

// 読み上げ対象のチャンネルを管理するオブジェクト
const activeChannels = {};

// 読み上げ言語のデフォルト設定
const defaultLanguages = {};

// ボイスコネクションを管理するオブジェクト
const voiceConnections = {};

// 音声プレイヤーを管理するオブジェクト
const audioPlayers = {};

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
function playAudio(interaction, isContextMenu = false) {
  try {
    // ユーザーがボイスチャンネルにいるか確認
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.followUp('ボイスチャンネルに接続してください');
    }

    const guildId = interaction.guild.id;
    
    // 既存のプレイヤーとコネクションを取得または作成
    let player = audioPlayers[guildId];
    let connection = voiceConnections[guildId];
    
    // コネクションがない場合は新規作成
    if (!connection) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      voiceConnections[guildId] = connection;
      
      console.log(`ボイスチャンネル ${voiceChannel.name} に接続しました`);
    }
    
    // プレイヤーがない場合は新規作成
    if (!player) {
      player = createAudioPlayer();
      connection.subscribe(player);
      audioPlayers[guildId] = player;
      
      // エラーハンドリング
      player.on('error', error => {
        console.error('再生エラー:', error);
        if (isContextMenu) {
          interaction.followUp('音声の再生中にエラーが発生しました');
        }
      });
    }

    // 音声ファイルを再生、音量を設定
    const resource = createAudioResource('./output.mp3', {
      inlineVolume: true
    });
    resource.volume.setVolume(defaultVolume);
    player.play(resource);

    // コンテキストメニューからの再生の場合のみ完了メッセージを表示
    if (isContextMenu) {
      player.once(AudioPlayerStatus.Idle, () => {
        interaction.followUp('読み上げが完了しました');
      });
    }

    return true;
  } catch (error) {
    console.error('音声再生エラー:', error);
    return false;
  }
}

// ボイスチャンネルから切断する関数
function disconnectFromVoice(guildId) {
  const connection = voiceConnections[guildId];
  const player = audioPlayers[guildId];
  
  if (connection) {
    connection.destroy();
    delete voiceConnections[guildId];
    console.log(`ギルド ${guildId} のボイスチャンネルから切断しました`);
  }
  
  if (player) {
    player.stop();
    delete audioPlayers[guildId];
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
      console.error('音声生成に失敗しました');
      return;
    }
    
    // ギルドIDを取得
    const guildId = message.guild.id;
    
    // 既存のボイスコネクションがあるか確認
    let connection = voiceConnections[guildId];
    let player = audioPlayers[guildId];
    
    // コネクションがない場合は、メッセージ送信者のボイスチャンネルに接続
    if (!connection) {
      // ユーザーがボイスチャンネルにいるか確認
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        console.log('ユーザーはボイスチャンネルに接続していません');
        return;
      }
      
      // ボイスチャンネルに接続
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      voiceConnections[guildId] = connection;
      console.log(`ボイスチャンネル ${voiceChannel.name} に接続しました`);
      
      // 切断イベントハンドラーを設定
      connection.on('stateChange', (oldState, newState) => {
        if (newState.status === 'disconnected') {
          delete voiceConnections[guildId];
          delete audioPlayers[guildId];
          console.log(`ボイスチャンネルから切断されました`);
        }
      });
    }
    
    // プレイヤーがない場合は新規作成
    if (!player) {
      player = createAudioPlayer();
      connection.subscribe(player);
      audioPlayers[guildId] = player;
      
      // エラーハンドリング
      player.on('error', error => {
        console.error('再生エラー:', error);
      });
    }
    
    // 音声ファイルを再生、音量を設定
    const resource = createAudioResource('./output.mp3', {
      inlineVolume: true
    });
    resource.volume.setVolume(defaultVolume);
    player.play(resource);
  } catch (error) {
    console.error('メッセージ読み上げエラー:', error);
  }
});

client.on('interactionCreate', async interaction => {
  // スラッシュコマンドの処理
  if (interaction.isChatInputCommand()) {
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
    
    if (interaction.commandName === 'volume') {
      const level = interaction.options.getNumber('level');
      
      // 範囲外の値をチェック
      if (level < 0.1 || level > 2.0) {
        return interaction.reply({ content: '音量は0.1～2.0の間で指定してください。', ephemeral: true });
      }
      
      // デフォルトの音量を更新
      defaultVolume = level;
      
      // 現在再生中のプレイヤーがあれば、音量を即度に適用
      const guildId = interaction.guild.id;
      const player = audioPlayers[guildId];
      if (player && player.state.resource) {
        player.state.resource.volume.setVolume(level);
      }
      
      await interaction.reply({ content: `音量を${level}倍に設定しました。`, ephemeral: true });
    }
    
    if (interaction.commandName === 'settings') {
      // 現在の設定を取得
      const speed = defaultSpeakingRate;
      const volume = defaultVolume;
      
      // 設定情報を表示
      const embed = {
        color: 0x0099FF,
        title: '現在の設定',
        fields: [
          {
            name: '読み上げ速度',
            value: `${speed}倍`,
            inline: true
          },
          {
            name: '音量',
            value: `${volume}倍`,
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Tai Util'
        }
      };
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (interaction.commandName === 'listen') {
      const channel = interaction.options.getChannel('channel');
      const language = interaction.options.getString('language') || 'ja-JP';
      
      // チャンネルがテキストチャンネルか確認
      if (channel.type !== 0) { // 0 = GUILD_TEXT
        return interaction.reply({ content: 'テキストチャンネルを選択してください。', ephemeral: true });
      }
      
      // 既に監視中の場合は言語を更新
      if (activeChannels[channel.id]) {
        defaultLanguages[channel.id] = language;
        return interaction.reply({ content: `${channel.name} の読み上げ言語を${getLanguageName(language)}に更新しました。`, ephemeral: true });
      }
      
      // 監視リストに追加
      activeChannels[channel.id] = true;
      defaultLanguages[channel.id] = language;
      
      // 接続するボイスチャンネルを取得
      const guildId = interaction.guild.id;
      let voiceChannel = interaction.options.getChannel('voicechannel');
      
      // ボイスチャンネルが指定されていない場合、ユーザーの現在のボイスチャンネルを使用
      if (!voiceChannel) {
        voiceChannel = interaction.member.voice.channel;
      }
      
      // ボイスチャンネルが指定されていない場合、サーバーの最初のボイスチャンネルを使用
      if (!voiceChannel) {
        const guildChannels = interaction.guild.channels.cache.filter(ch => ch.type === 2); // 2 = GUILD_VOICE
        if (guildChannels.size > 0) {
          voiceChannel = guildChannels.first();
        } else {
          return interaction.reply({ content: 'ボイスチャンネルが見つかりません。ボイスチャンネルを指定するか、ボイスチャンネルに接続してから再度お試しください。', ephemeral: true });
        }
      }
      
      // ボイスチャンネルが実際にボイスチャンネルか確認
      if (voiceChannel.type !== 2) { // 2 = GUILD_VOICE
        return interaction.reply({ content: 'ボイスチャンネルを選択してください。', ephemeral: true });
      }
      
      // ボイスチャンネルに接続
      if (!voiceConnections[guildId]) {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });
        voiceConnections[guildId] = connection;
        
        // 切断イベントハンドラーを設定
        connection.on('stateChange', (oldState, newState) => {
          if (newState.status === 'disconnected') {
            delete voiceConnections[guildId];
            delete audioPlayers[guildId];
            console.log(`ボイスチャンネルから切断されました`);
          }
        });
        
        // オーディオプレイヤーを作成
        const player = createAudioPlayer();
        connection.subscribe(player);
        audioPlayers[guildId] = player;
        
        // エラーハンドリング
        player.on('error', error => {
          console.error('再生エラー:', error);
        });
        
        await interaction.reply({ content: `${channel.name} のメッセージを${getLanguageName(language)}で読み上げます。\nボイスチャンネル ${voiceChannel.name} に接続しました。`, ephemeral: false });
      } else {
        await interaction.reply({ content: `${channel.name} のメッセージを${getLanguageName(language)}で読み上げます。\n既にボイスチャンネルに接続しています。`, ephemeral: false });
      }
    }
    
    if (interaction.commandName === 'stop') {
      const channel = interaction.options.getChannel('channel');
      
      if (!activeChannels[channel.id]) {
        return interaction.reply({ content: `${channel.name} は現在読み上げていません。`, ephemeral: true });
      }
      
      // 監視リストから削除
      delete activeChannels[channel.id];
      delete defaultLanguages[channel.id];
      
      // チャンネルの監視対象がなくなった場合、ボイスチャンネルから切断
      const guildId = interaction.guild.id;
      const hasActiveChannels = Object.keys(activeChannels).some(id => {
        const ch = interaction.guild.channels.cache.get(id);
        return ch && ch.guild.id === guildId;
      });
      
      if (!hasActiveChannels) {
        disconnectFromVoice(guildId);
        await interaction.reply({ content: `${channel.name} の読み上げを停止し、ボイスチャンネルから切断しました。`, ephemeral: false });
      } else {
        await interaction.reply({ content: `${channel.name} の読み上げを停止しました。他のチャンネルの読み上げが継続中のため、ボイスチャンネルには接続したままです。`, ephemeral: false });
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
      playAudio(interaction, true);
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

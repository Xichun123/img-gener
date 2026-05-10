window.PROMPT_TEMPLATE_SOURCE = {
  "name": "combined-prompt-gallery",
  "license": "MIT",
  "sources": [
    {
      "name": "awesome-gpt-image-2",
      "url": "https://github.com/freestylefly/awesome-gpt-image-2",
      "copyright": "Copyright (c) 2026 freestylefly"
    },
    {
      "name": "banana-prompt-quicker",
      "url": "https://github.com/glidea/banana-prompt-quicker",
      "copyright": "Copyright (c) 2025 glidea",
      "skip_nsfw": true
    }
  ]
};

window.PROMPT_TEMPLATES = [
  {
    "id": "tpl-1",
    "category": "UI与界面",
    "title": "常规模板",
    "kind": "text",
    "prompt": "为[产品类型]生成一张[平台，如 iOS/Android/Web]界面图。\n核心功能：[功能点A]、[功能点B]、[功能点C]。\n视觉风格：[极简/科技/拟物]，主色[颜色]，强调色[颜色]。\n布局：[顶部导航/双栏/卡片流]，信息层级清晰，留白充足。\n输出：高保真UI截图，文字清晰可读，比例[9:16/16:9]。"
  },
  {
    "id": "tpl-2",
    "category": "UI与界面",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"UI Screenshot\",\n  \"platform\": \"iOS\",\n  \"product\": \"Fitness App\",\n  \"layout\": \"Card-based feed with bottom tab bar\",\n  \"style\": {\n    \"theme\": \"Dark Mode\",\n    \"primary_color\": \"Neon Green\",\n    \"typography\": \"Clean sans-serif\"\n  },\n  \"content\": {\n    \"header\": \"Today's Activity\",\n    \"cards\": [\n      {\"title\": \"Running\", \"data\": \"5.2 km\", \"button\": \"Start\"},\n      {\"title\": \"Calories\", \"data\": \"340 kcal\"}\n    ]\n  },\n  \"constraints\": \"High fidelity, readable text, 9:16 aspect ratio\"\n}"
  },
  {
    "id": "tpl-3",
    "category": "图表与信息可视化",
    "title": "常规模板",
    "kind": "text",
    "prompt": "生成[主题]信息图，目标读者为[人群]。\n结构：标题区 + [3-5]个模块（每模块含图标、短标题、1-2句说明）。\n图表类型：[流程图/对比图/关系图/时间线]。\n风格：[专业报告/科普插画]，主色[颜色]，背景[浅色/深色]。\n输出：信息层级清晰、可读性高的中文信息图。"
  },
  {
    "id": "tpl-4",
    "category": "图表与信息可视化",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Infographic\",\n  \"topic\": \"Urban Metabolism\",\n  \"audience\": \"General Public\",\n  \"structure\": {\n    \"title_area\": \"城市生命系统图谱\",\n    \"layout\": \"Isometric cutaway, 12 numbered panels\",\n    \"modules\": [\n      {\"title\": \"能源\", \"icon\": \"lightning\", \"text\": \"Power flows\"},\n      {\"title\": \"水循环\", \"icon\": \"water_drop\", \"text\": \"Water flows\"}\n    ]\n  },\n  \"style\": {\n    \"aesthetic\": \"Scientific atlas\",\n    \"colors\": \"Low saturation, color-coded flows\",\n    \"background\": \"Light paper texture\"\n  },\n  \"constraints\": \"No cyberpunk, no gibberish text, strict structural layout\"\n}"
  },
  {
    "id": "tpl-5",
    "category": "海报与排版",
    "title": "常规模板",
    "kind": "text",
    "prompt": "设计一张[活动/产品/电影]海报，主题为[主题词]。\n主视觉：[主体元素]，标题文案：[标题]，副标题：[副标题]。\n版式：[居中/左对齐/对角构图]，风格：[复古/未来/极简]。\n色彩：[主色 + 辅色]，氛围：[情绪关键词]。\n输出：可用于社媒传播的高分辨率海报。"
  },
  {
    "id": "tpl-6",
    "category": "海报与排版",
    "title": "运动商业 Campaign 模板",
    "kind": "text",
    "prompt": "设计一张[运动项目/健身品类]商业 Campaign 海报。\n主体：[运动员/模特/产品道具]，姿态：[坐姿/冲刺/挥拍/力量动作]。\n核心道具：[球拍/哑铃/球鞋/球衣]，以夸张比例或对角构图成为视觉锚点。\n版式：[单张强主视觉/三联画/数据涂鸦海报]。\n大字标题：\"[主标题]\"，辅助文案：\"[短句/数据/精神口号]\"。\n视觉风格：高端运动品牌广告，强光影，反光地面，干净构图，品牌化配色[主色+辅助色]。\n约束：主体清晰，文字可读，色调统一，不要杂乱拼贴，不要生成错误运动器材。\n输出：1:1 或 4:5，适合社媒传播的运动商业视觉。"
  },
  {
    "id": "tpl-7",
    "category": "海报与排版",
    "title": "概念字体海报模板",
    "kind": "text",
    "prompt": "Create ONE finished premium conceptual typography poster for the exact title:\n\n\"[标题/词语/短句]\"\n\nSingle poster only. No moodboard, grid, presentation board, mockup, captions, prompt text, process sheet, or sample labels.\n\nThe title must be the dominant visual structure of the poster: huge, readable, powerful, and spelled exactly. Do not translate, shorten, replace, or misspell it. Do not add other large readable text.\n\nSilently interpret the title's meaning, mood, cultural aura, symbolic associations, psychological tension, and visual rhythm. Turn that interpretation into one strong visual metaphor.\n\nTypography is the hero. Design custom-looking letterforms whose weight, width, contrast, spacing, rhythm, distortion, negative space, edge quality, and ink texture express the temperament of the title. The type should feel intentionally designed, not like a default font.\n\nIf the title refers to a widely known person, make a large editorial portrait or half-body figure a major visual presence, occupying roughly 40%-70% of the composition. The figure should interact with the typography: overlapping the letters, emerging from them, being framed by them, casting shadows on them, breaking through them, or being partially hidden behind them.\n\nFor abstract or non-person titles, use a human figure, landscape, object, or atmospheric setting only when it strengthens the meaning. It must interact with the typography and deepen the concept, not decorate it.\n\nUse a restrained 4-6 color system matched to the theme: dominant background color, primary typography color, figure / landscape tone, emotional accent color, muted support color, and subtle paper / ink texture tone.\n\nComposition style: high-end editorial poster, museum-quality graphic design, dramatic scale, strong hierarchy, few elements, intelligent whitespace, bold flat color areas, sharp cropping, silkscreen / lithograph / risograph grain, paper fibers, subtle ink imperfections, refined visual tension.\n\nAvoid generic word art, glossy 3D lettering, random icons, stock-photo realism, cluttered collage, excessive grunge, tourist clichés, official logos, copied slogans, copied campaign aesthetics, unrelated text, and misspelled typography."
  },
  {
    "id": "tpl-8",
    "category": "海报与排版",
    "title": "水墨双重曝光人物海报模板",
    "kind": "text",
    "prompt": "生成一张[人物/角色/品牌主理人/运动员]的水墨双重曝光人物海报。\n画幅：9:16 竖版，高级电影海报构图。\n主体结构：\n- 上半区：放大的人物头部、面部轮廓或半身剪影，形成最强识别锚点。\n- 中下区：同一人物的全身或半身主体，姿态为[站姿/动作姿态/凝视镜头]。\n- 剪影内部：融合[关键场景]、[象征物]、[叙事片段]、[环境纹理]，形成双重曝光叙事。\n视觉连接：用云雾、水墨扩散、飞白边缘、负空间和柔和明暗过渡，把上方剪影、内部拼贴和下方主体连成一条从上到下的视觉动线。\n风格：东方水墨美学 + 写实电影感，克制、高级、留白充足，层次丰富但不杂乱。\n文字：可加入[标题/姓名/短句]，必须少量、可读、像海报题签而不是信息图说明。\n约束：不要硬拼贴，不要把背景塞满，不要廉价武侠特效，不要复制真实海报版式，不要让剪影和主体互相抢焦点。\n输出：海报级完成图，主体清晰，水墨边缘自然，叙事元素与人物身份强相关。"
  },
  {
    "id": "tpl-9",
    "category": "海报与排版",
    "title": "自然科普海报模板",
    "kind": "text",
    "prompt": "你是一个高端自然科普海报生成系统，目标是为稀有动物、昆虫、爬行动物、哺乳动物或其他小众生物生成 Apple keynote 风格的高级科普视觉海报。\n\n整体视觉方向：\n生成一张 9:16 竖版高级科普海报，画面采用极简、纯白、干净、现代、Apple 式产品发布海报语言。背景应为纯白或极浅灰白渐变，保持大量留白。整体设计应具备高级感、克制感、视觉冲击力和科学展示感。\n\n核心设计原则：\n1. 主体动物必须被极度放大，成为画面最强视觉中心。\n2. 主体应具有强烈立体感、真实质感、高清细节和柔和棚拍光影。\n3. 海报信息要少而准，避免拥挤。\n4. 不使用传统信息图的卡片、圆角框、复杂底纹、淡黄色纸张质感或装饰性边框。\n5. 底部信息区只使用四列极简 icon + 标题 + 短说明，通过细竖线分隔。\n6. 文字排版要像高端发布会视觉，标题巨大，副标题克制，正文小而清晰。\n7. 风格关键词：Apple-inspired, premium editorial, pure white background, hero subject, clean typography, minimal infographic, high-end science poster.\n\n画面结构：\n顶部左侧为标题区：\n中文大标题：{中文物种名}\n中文副标题：{一句有吸引力的物种定位}\n细短横线\n英文名：{英文物种名}\n分布信息：主要分布：{分布区域}\n\n中部与下中部为主体视觉：\n生成一个超高清、真实、具有强烈立体感的 {中文物种名}。\n主体应占据画面 50% 到 70% 的视觉面积。\n主体姿态应具有展示性、力量感或识别度。\n保持白色背景，不添加复杂自然环境。\n可以保留少量必要承托物，例如树枝、岩石、雪地、沙土或木皮，但必须简洁。\n主体要有真实阴影，使其像高级产品摄影一样立在画面中。\n\n底部信息区：\n用四个极简信息栏目展示科普信息。\n每个栏目包含：\n一个细线 icon\n一个彩色小标题\n一段 1 到 3 行短文字\n栏目之间用极细浅灰竖线分隔。\n不使用卡片框，不使用圆角背景，不使用大面积色块。\n\n四个信息栏目：\n栏目 1：\n标题：{重点特征1标题}\n说明：{重点特征1短说明}\n\n栏目 2：\n标题：{重点特征2标题}\n说明：{重点特征2短说明}\n\n栏目 3：\n标题：{重点特征3标题}\n说明：{重点特征3短说明}\n\n栏目 4：\n标题：{重点特征4标题}\n说明：{重点特征4短说明}\n\n底部总结句：\n在最底部居中放置一句灰色小字总结：\n{一句高级、克制、有记忆点的科普总结}\n\n字体与排版：\n中文标题使用大号黑色、高级、稳重、有力量感的字体。\n副标题使用灰色，中等字号，字距略宽。\n英文名使用小号灰色，简洁现代。\n正文使用清晰现代中文字体，保持可读。\n所有文字必须留有足够呼吸感。\n\n色彩规范：\n背景：纯白、极浅灰、轻微柔光渐变。\n主标题：黑色或深石墨色。\n副标题与正文：中性灰。\n底部四个信息标题可使用低饱和强调色：\n暖棕、冷蓝、松石绿、紫色、橙色。\n颜色只用于 icon 和小标题，不要大面积铺色。\n\n图像质量：\n2K 高清质感，细节清晰，主体锐利，光影真实。\n主体纹理必须可信，例如毛发、鳞片、甲壳、皮肤褶皱、羽毛或斑纹。\n避免变形、错误肢体、错误解剖结构、模糊主体、低质贴图、塑料感、卡通感。\n\n禁止项：\n不要使用淡黄色旧纸背景。\n不要使用复杂信息图网格。\n不要使用圆角卡片。\n不要使用厚边框。\n不要使用大面积装饰图形。\n不要添加无关 logo。\n不要添加多余小字。\n不要让主体太小。\n不要让文字压住主体。\n不要让底部信息区过度拥挤。\n不要出现儿童科普风、卡通风、低端展板风。\n\n最终输出：\n生成一张 9:16 竖版、高级、干净、强视觉冲击的 Apple 风自然科普海报。"
  },
  {
    "id": "tpl-10",
    "category": "海报与排版",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Movie Poster\",\n  \"theme\": \"Interstellar Journey\",\n  \"typography\": {\n    \"headline\": \"BEYOND STARS\",\n    \"subheading\": \"A New Era Begins\",\n    \"layout\": \"Centered, bold cinematic font, bottom heavy\"\n  },\n  \"visuals\": {\n    \"subject\": \"Silhouette of an astronaut looking at a glowing nebula\",\n    \"style\": \"Cinematic lighting, high contrast, dramatic shadows\",\n    \"color_palette\": \"Deep space blue, glowing orange accents\"\n  },\n  \"vibe\": \"Epic, mysterious, vast\"\n}"
  },
  {
    "id": "tpl-11",
    "category": "商品与电商",
    "title": "常规模板",
    "kind": "text",
    "prompt": "生成[商品名]电商主图，卖点为[卖点1]、[卖点2]。\n场景：[纯色棚拍/生活方式场景]，镜头：[特写/半身/全景]。\n材质细节：[材质关键词]，灯光：[柔光/侧光/轮廓光]。\n附加元素：[价格角标/卖点icon/促销文案]。\n输出：电商平台可直接使用的商品展示图。"
  },
  {
    "id": "tpl-12",
    "category": "商品与电商",
    "title": "个人化美妆推荐报告模板",
    "kind": "text",
    "prompt": "你是一个专业美妆顾问 + 人脸分析系统 + 品牌视觉设计系统。\n目标：基于[用户自拍]与[口红品牌]，生成一张具有“分析 + 推荐 + 试色 + 场景建议”的竖版口红推荐报告信息图。\n\n输入参数：\n用户图像：[用户自拍]\n品牌：[Dior / YSL / Armani / Chanel / TF / 其他品牌]\n风格偏好（可选）：[通勤 / 温柔 / 气场 / 氛围感 / 显白优先]\n推荐数量：[3-5]\n\n分析层：\n- 判断肤色：冷 / 暖 / 中性（含明度）\n- 判断气质：清冷 / 温柔 / 明艳 / 干净 / 成熟\n- 判断唇部基础：唇色深浅、唇形、适合浓淡\n- 输出一句总结：「更适合 [色系] + [饱和度] + [质地] 的口红方向」\n\n推荐层：\n从[品牌]中筛选[3-5]个差异化色号，每个色号包含：\n- 色号名称\n- 色系标签\n- 上脸效果\n- 推荐场景\n\n品牌视觉层：\n根据[品牌]自动生成视觉调性，只用少量品牌强调色做标题、细线、小 icon 和局部点缀。\n示例：YSL 黑金强对比，Dior 法式柔光灰白，Armani 低饱和雾面，Chanel 极简黑白，TF 深色电影感。\n\n版式结构：\n左上：用户输入图 + 肤色分析\n右上：一句分析结论\n中部：3-5 个同一张脸的唇色试色矩阵，每列一个色号\n底部：有判断力的个人建议\n\n视觉要求：\n高端美妆编辑视觉，结构化信息可视化排版，真实皮肤质感，唇色精准，统一光影，9:16 竖版，8K。"
  },
  {
    "id": "tpl-13",
    "category": "商品与电商",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"E-commerce Hero Image\",\n  \"product\": {\n    \"name\": \"Noise Cancelling Headphones\",\n    \"material\": \"Matte black finish with metallic accents\",\n    \"angle\": \"3/4 profile, floating slightly\"\n  },\n  \"setting\": {\n    \"background\": \"Minimalist studio setup, soft gray gradient\",\n    \"lighting\": \"Softbox overhead, sharp rim light on edges\"\n  },\n  \"copywriting\": {\n    \"badges\": [\"NEW\", \"$299\"],\n    \"slogan\": \"Silence the World\"\n  },\n  \"constraints\": \"Commercial photography quality, hyper-realistic textures\"\n}"
  },
  {
    "id": "tpl-14",
    "category": "品牌与标志",
    "title": "常规模板",
    "kind": "text",
    "prompt": "为[品牌名]设计品牌视觉方案。\n品牌关键词：[关键词1]、[关键词2]、[关键词3]。\n包含：Logo方向[几何/字标/图形]、辅助图形、主辅色、应用示意。\n风格：[现代/高级/亲和]，行业：[行业]，受众：[受众]。\n输出：统一风格的品牌识别视觉图。"
  },
  {
    "id": "tpl-15",
    "category": "品牌与标志",
    "title": "完整品牌身份包模板",
    "kind": "text",
    "prompt": "你是顶级品牌代理创意总监，目标是为[业务/产品]交付一套覆盖 Logo、配色、字体、语调和应用触点的完整品牌身份系统。\n\n输入信息：\n业务名称：[业务名]\n业务描述：[一句话说明]\n行业：[行业]\n目标受众：[详细描述]\n竞争对手：[3-5个]\n品牌个性：[5个关键词]\n希望触发的感受：[信任 / 兴奋 / 奢华 / 亲近 / 力量 / 其他]\n喜欢的视觉身份：[3个参考]\n讨厌的视觉身份：[3个反例]\n设计预算：[免费 / 付费]\n\n请输出：\n1. 品牌战略基础：品牌原型、核心承诺、定位、差异化和唯一关键词。\n2. Logo 概念：生成 3-5 个完全不同的 Logo 方向，每个方向说明核心视觉理念、形状语言、象征意义、字体方向、第一眼情绪和适用触点。\n3. 配色系统：主色、辅助色、强调色、中性色、HEX 代码、心理学解释、使用规则和禁用搭配。\n4. 字体系统：标题字体、正文字体、强调字体、字号层级、字距、行高和免费替代方案。\n5. 应用触点：名片、App 图标、网站首页、社媒模板、广告牌或包装上的应用效果。\n6. 品牌规则：3 条永远不要打破的核心品牌规则。\n\n输出形式：\n结构化品牌手册，任何设计师、开发者或 AI 工具都能在 10 分钟内理解并复用。"
  },
  {
    "id": "tpl-16",
    "category": "品牌与标志",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Brand Identity Design\",\n  \"brand\": {\n    \"name\": \"Nova Dynamics\",\n    \"industry\": \"AI Technology\",\n    \"keywords\": [\"Innovative\", \"Minimalist\", \"Trustworthy\"]\n  },\n  \"deliverables\": [\n    \"Logo mark (geometric fusion of a neural network node and a star)\",\n    \"Color palette (Electric Blue and Pure White)\",\n    \"Business card mockup\"\n  ],\n  \"style\": \"Modern corporate, flat vector, high contrast\",\n  \"constraints\": \"No gradients, scalable vector style, clean white background for logo\"\n}"
  },
  {
    "id": "tpl-17",
    "category": "建筑与空间",
    "title": "常规模板",
    "kind": "text",
    "prompt": "生成[空间类型]设计效果图，功能定位为[用途]。\n风格：[现代简约/工业/新中式]，材质：[木/石/金属/玻璃]。\n空间结构：[开敞/分区]，动线：[主通道说明]。\n光线：[自然采光/人工照明方案]，时间：[白天/夜景]。\n输出：写实建筑空间渲染图。"
  },
  {
    "id": "tpl-18",
    "category": "建筑与空间",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Architectural Visualization\",\n  \"space\": {\n    \"type\": \"Modern Cabin Interior\",\n    \"function\": \"Living room\",\n    \"materials\": \"Exposed concrete, large floor-to-ceiling glass, warm timber accents\"\n  },\n  \"environment\": \"Nestled in a dense, snowy pine forest visible through the glass\",\n  \"camera\": {\n    \"angle\": \"Eye-level perspective, wide-angle lens\",\n    \"lighting\": \"Golden hour, warm interior lights glowing, cool blue ambient light outside\"\n  },\n  \"render_quality\": \"Unreal Engine 5 style, hyper-realistic, 8k resolution, ray tracing\"\n}"
  },
  {
    "id": "tpl-19",
    "category": "摄影与写实",
    "title": "常规模板",
    "kind": "text",
    "prompt": "拍摄主题：[人物/物品/街景]，场景为[地点]。\n摄影参数风格：[35mm/85mm]，[浅景深/深景深]，[纪实/电影感]。\n光线：[自然光/夜景霓虹/逆光]，情绪：[情绪词]。\n细节要求：[肤质/材质/颗粒感]。\n输出：高写实摄影风格图像。"
  },
  {
    "id": "tpl-20",
    "category": "摄影与写实",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Hyper-realistic Photography\",\n  \"subject\": {\n    \"description\": \"A weary 30-year-old barista wiping a coffee cup\",\n    \"details\": \"Subtle sweat on forehead, detailed skin pores, wearing a denim apron\"\n  },\n  \"setting\": \"Dimly lit vintage cafe, rain visible through the window behind\",\n  \"camera_specs\": {\n    \"gear\": \"Shot on Sony A7R IV, 50mm lens\",\n    \"aperture\": \"f/1.4 (shallow depth of field, background completely blurred)\",\n    \"lighting\": \"Cinematic lighting, neon sign reflecting on wet window, soft rim light on subject's hair\"\n  },\n  \"film_aesthetic\": \"Kodak Portra 400 emulation, subtle film grain\"\n}"
  },
  {
    "id": "tpl-21",
    "category": "插画与艺术",
    "title": "常规模板",
    "kind": "text",
    "prompt": "创作[题材]插画，主角为[角色/主体]。\n画风：[日漫/水彩/扁平/厚涂]，线条：[细腻/粗犷]。\n配色：[配色方案]，背景：[简洁/复杂场景]。\n构图：[近景/中景/远景]，重点表现[细节]。\n输出：可用于封面或社媒发布的高质量插画。"
  },
  {
    "id": "tpl-22",
    "category": "插画与艺术",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Artistic Illustration\",\n  \"art_style\": \"Studio Ghibli inspired anime style\",\n  \"scene\": {\n    \"description\": \"A giant flying whale carrying a small cozy village on its back\",\n    \"details\": \"Windmills turning, tiny people looking over the edge, fluffy white clouds\"\n  },\n  \"palette\": \"Vibrant sky blue, lush greens, soft pastel accents\",\n  \"technique\": \"Cel shading, detailed background art, soft glowing magical aura\",\n  \"mood\": \"Whimsical, adventurous, nostalgic\"\n}"
  },
  {
    "id": "tpl-23",
    "category": "人物与角色",
    "title": "常规模板",
    "kind": "text",
    "prompt": "设计[角色身份]角色设定图。\n外观：[年龄/发型/服饰/配件]，性格：[关键词]。\n姿态：[站姿/动态动作]，表情：[情绪]。\n世界观：[时代/阵营/职业]，标志性元素：[元素]。\n输出：角色主视图 + 风格统一的人设图。"
  },
  {
    "id": "tpl-24",
    "category": "人物与角色",
    "title": "动作分解参考表模板",
    "kind": "text",
    "prompt": "生成一张[角色/人物]动作分解参考表。\n风格：[黑白线稿/3D 灰阶/漫画分镜/教学图]，背景纯净，技术参考图气质。\n版式：4×4 网格，共 16 个等尺寸面板，细线分隔，每格左上角编号 1-16。\n角色一致性：所有面板使用同一角色，保持脸型、服装、比例和发型一致。\n每格结构：\n- 顶部：动作标题\n- 中央：完整身体动作姿态\n- 底部：3-4 行动作说明\n- 叠加：方向箭头、旋转箭头或运动轨迹线\n动作序列：[从基础站姿到结束动作的完整步骤]\n约束：不要复杂背景，不要新增角色，不要彩色干扰，不要改变角色身份。\n输出：清晰可读、可用于动画/舞蹈/游戏动作参考的角色动作表。"
  },
  {
    "id": "tpl-25",
    "category": "人物与角色",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Character Concept Art\",\n  \"character\": {\n    \"identity\": \"Cybernetic Bounty Hunter\",\n    \"appearance\": \"Short silver hair, glowing red synthetic left eye, athletic build\",\n    \"attire\": \"Tactical trench coat with neon piping, holding a plasma rifle\"\n  },\n  \"pose\": \"Dynamic action stance, looking over shoulder with a smirk\",\n  \"environment\": \"Rainy neon-lit alleyway background (blurred)\",\n  \"style\": \"Concept art, sharp linework, vibrant cyberpunk palette\"\n}"
  },
  {
    "id": "tpl-26",
    "category": "场景与叙事",
    "title": "常规模板",
    "kind": "text",
    "prompt": "生成[故事主题]场景图，发生在[时间+地点]。\n主事件：[事件描述]，主角：[角色]，冲突点：[冲突]。\n镜头语言：[广角建立镜头/中景叙事/特写]。\n氛围：[紧张/温暖/悬疑]，色调：[冷/暖/高反差]。\n输出：具备叙事张力的场景概念图。"
  },
  {
    "id": "tpl-27",
    "category": "场景与叙事",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Narrative Scene\",\n  \"story_context\": \"The exact moment an ancient seal breaks\",\n  \"environment\": \"Crumbling stone temple overgrown with glowing blue vines\",\n  \"action\": \"A young explorer dropping their torch as a massive beam of light shoots into the sky\",\n  \"atmosphere\": {\n    \"mood\": \"Awe-inspiring, terrifying\",\n    \"lighting\": \"Blinding central light casting long dramatic shadows\"\n  },\n  \"camera\": \"Low angle shot, emphasizing the scale of the light beam\"\n}"
  },
  {
    "id": "tpl-28",
    "category": "历史与古风题材",
    "title": "常规模板",
    "kind": "text",
    "prompt": "生成[朝代/古风设定]题材画面，主题为[主题]。\n人物：[身份/服饰/器物]，场景：[宫廷/市井/山水]。\n美术风格：[工笔/写意/影视写实]，色调：[色调]。\n文化细节：[纹样/礼制/建筑要素]。\n输出：历史氛围准确的古风题材图。"
  },
  {
    "id": "tpl-29",
    "category": "历史与古风题材",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Historical/Oriental Scene\",\n  \"setting\": \"Tang Dynasty Capital City at Night\",\n  \"subject\": {\n    \"identity\": \"Noblewoman\",\n    \"clothing\": \"Traditional Ruqun (襦裙) with elaborate floral embroidery\",\n    \"action\": \"Holding a glowing silk lantern, looking at fireworks\"\n  },\n  \"style\": \"Cinematic realism combined with subtle traditional ink wash (水墨) textures\",\n  \"details\": \"Accurate Tang architecture, bustling crowd in background\",\n  \"constraints\": \"No modern elements, historically accurate clothing structure\"\n}"
  },
  {
    "id": "tpl-30",
    "category": "文档与出版物",
    "title": "常规模板",
    "kind": "text",
    "prompt": "制作[文档类型，如菜单/杂志内页/报纸版式]。\n版面结构：[栏数/页边距/标题层级]。\n内容模块：[封面区/正文区/图表区/脚注]。\n字体风格：[衬线/无衬线]，配色：[配色方案]。\n输出：可读性强、版式规范的出版物视觉稿。"
  },
  {
    "id": "tpl-31",
    "category": "文档与出版物",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Editorial Layout\",\n  \"document\": \"Fashion Magazine Double-page Spread\",\n  \"grid\": \"3-column grid, wide margins\",\n  \"content\": {\n    \"left_page\": \"Full-bleed high-fashion photograph of a model in a red dress\",\n    \"right_page\": {\n      \"headline\": \"THE RED RENAISSANCE\",\n      \"body_text\": \"(Simulated text blocks)\",\n      \"pull_quote\": \"\\\"Color is power.\\\"\"\n    }\n  },\n  \"typography\": \"Elegant serif for headlines, clean sans-serif for body\",\n  \"palette\": \"Monochrome with stark red accents\"\n}"
  },
  {
    "id": "tpl-32",
    "category": "其他应用场景",
    "title": "常规模板",
    "kind": "text",
    "prompt": "任务目标：[你要生成的内容类型]。\n输入约束：主体[主体]，场景[场景]，风格[风格]，色彩[配色]。\n质量约束：清晰度[高清/4K]，比例[比例]，构图[构图方式]。\n输出约束：用于[用途]，需突出[核心信息]。\n请输出一版主方案 + 一版备选方案。"
  },
  {
    "id": "tpl-33",
    "category": "其他应用场景",
    "title": "JSON 进阶模板（推荐给 Agent 调用）",
    "kind": "json",
    "prompt": "{\n  \"type\": \"Custom Generation\",\n  \"objective\": \"Generate [Specific content]\",\n  \"inputs\": {\n    \"subject\": \"[Main subject details]\",\n    \"scene\": \"[Background and context]\",\n    \"style\": \"[Artistic/Visual style]\",\n    \"palette\": \"[Color scheme]\"\n  },\n  \"quality_constraints\": {\n    \"resolution\": \"8k, hyper-detailed\",\n    \"aspect_ratio\": \"[e.g., 16:9]\",\n    \"composition\": \"[e.g., Rule of thirds]\"\n  },\n  \"output_requirements\": {\n    \"usage\": \"[Intended use case]\",\n    \"focus\": \"[Key element to highlight]\"\n  }\n}"
  }
];

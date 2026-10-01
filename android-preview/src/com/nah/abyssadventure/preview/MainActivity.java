package com.nah.abyssadventure.preview;

import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.webkit.*;
import android.net.Uri;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
 private WebView web;
 private SQLiteOpenHelper helper;
 private String pickerId, pickerPayload;
 private static final int EXPORT=101, IMPORT=102;
 private static final String HOST="appassets.androidplatform.net";
 @Override public void onCreate(Bundle saved){super.onCreate(saved);
  getWindow().setStatusBarColor(0xff15131a);getWindow().setNavigationBarColor(0xff15131a);
  helper=new SQLiteOpenHelper(this,"abyss-r67.db",null,1){
   public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE records (key TEXT PRIMARY KEY,value TEXT NOT NULL)");}
   public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){throw new IllegalStateException("Unsupported save database version");}
  };
  web=new WebView(this);web.setBackgroundColor(0xff15131a);setContentView(web);
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);
  web.addJavascriptInterface(new NativeHost(),"AbyssPreviewNative");
  web.setWebChromeClient(new WebChromeClient());
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !trusted(request.getUrl());}
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    Uri uri=request.getUrl();if(!trusted(uri))return response(403,"Forbidden",new byte[0],"text/plain");
    String path=uri.getPath();if(path==null||path.equals("/"))path="/index.html";
    if(path.contains("..")||path.indexOf('\\')>=0)return response(403,"Forbidden",new byte[0],"text/plain");
    try{InputStream input=getAssets().open("public"+path);Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");return new WebResourceResponse(mime(path),"UTF-8",200,"OK",headers,input);}catch(IOException e){return response(404,"Not Found",new byte[0],"text/plain");}
   }
  });
  web.loadUrl("https://"+HOST+"/index.html");
 }
 private static boolean trusted(Uri uri){return "https".equals(uri.getScheme())&&HOST.equals(uri.getHost());}
 private static String mime(String path){if(path.endsWith(".js"))return "application/javascript";if(path.endsWith(".css"))return "text/css";if(path.endsWith(".json"))return "application/json";if(path.endsWith(".svg"))return "image/svg+xml";if(path.endsWith(".png"))return "image/png";return "text/html";}
 private static WebResourceResponse response(int code,String reason,byte[] bytes,String type){return new WebResourceResponse(type,"UTF-8",code,reason,new HashMap<String,String>(),new ByteArrayInputStream(bytes));}
 private String get(SQLiteDatabase db,String key,String fallback){try(Cursor c=db.rawQuery("SELECT value FROM records WHERE key=?",new String[]{key})){return c.moveToFirst()?c.getString(0):fallback;}}
 private void put(SQLiteDatabase db,String key,String value){db.execSQL("INSERT OR REPLACE INTO records(key,value) VALUES (?,?)",new Object[]{key,value});}
 private void reply(String id,Object value,String error){try{JSONObject result=new JSONObject();result.put("id",id);result.put("value",value==null?JSONObject.NULL:value);if(error!=null)result.put("error",error);final String script="window.__abyssNativeReply && window.__abyssNativeReply("+JSONObject.quote(result.toString())+")";runOnUiThread(()->{if(web!=null)web.evaluateJavascript(script,null);});}catch(JSONException ignored){}}
 private class NativeHost {
  @JavascriptInterface public synchronized void call(String payload){String id="";try{
   JSONObject request=new JSONObject(payload);id=request.getString("id");String method=request.getString("method");JSONObject args=request.optJSONObject("args");Object result=null;
   if("clock".equals(method)){JSONObject clock=new JSONObject();clock.put("elapsed",SystemClock.elapsedRealtime());clock.put("wall",System.currentTimeMillis());try{clock.put("boot","android-"+Settings.Global.getInt(getContentResolver(),Settings.Global.BOOT_COUNT));}catch(Exception e){clock.put("boot",JSONObject.NULL);}result=clock;
   }else if("read".equals(method)){SQLiteDatabase db=helper.getReadableDatabase();JSONObject read=new JSONObject();db.beginTransaction();try{read.put("records",new JSONArray(get(db,"snapshots","[]")));read.put("storageRevision",Long.parseLong(get(db,"revision","-1")));db.setTransactionSuccessful();}finally{db.endTransaction();}result=read;
   }else if("commit".equals(method)){String snapshot=args.getString("payload");if(snapshot.length()>32*1024*1024)throw new IOException("Save exceeds 32 MiB");SQLiteDatabase db=helper.getWritableDatabase();db.beginTransaction();try{if(!args.optBoolean("replace")&&Long.parseLong(get(db,"revision","-1"))!=args.getLong("expectedRevision"))throw new IOException("Save conflict");String previous=get(db,"snapshots","[]");if(args.optBoolean("replace")||args.optBoolean("quarantine"))put(db,"quarantine-"+System.currentTimeMillis(),previous);JSONArray old=new JSONArray(previous),next=new JSONArray();next.put(snapshot);for(int i=0;i<Math.min(3,old.length());i++)next.put(old.getString(i));put(db,"snapshots",next.toString());put(db,"revision",Long.toString(args.getLong("revision")));db.setTransactionSuccessful();}finally{db.endTransaction();}
   }else if("exportFile".equals(method)||"importFile".equals(method)){final String requestId=id;final JSONObject requestArgs=args;final boolean exporting="exportFile".equals(method);runOnUiThread(()->openPicker(requestId,requestArgs,exporting));return;
   }else throw new IOException("Unknown native method");reply(id,result,null);
  }catch(Exception e){reply(id,null,e.getMessage()==null?e.toString():e.getMessage());}}
 }
 private void openPicker(String id,JSONObject args,boolean exporting){if(pickerId!=null){reply(id,null,"A file picker is already open");return;}pickerId=id;pickerPayload=exporting?args.optString("payload"):null;Intent intent=new Intent(exporting?Intent.ACTION_CREATE_DOCUMENT:Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/json");if(exporting)intent.putExtra(Intent.EXTRA_TITLE,args.optString("name","Abyss-backup.json"));try{startActivityForResult(intent,exporting?EXPORT:IMPORT);}catch(Exception e){pickerId=null;pickerPayload=null;reply(id,null,e.toString());}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=EXPORT&&request!=IMPORT)return;String id=pickerId,payload=pickerPayload;pickerId=null;pickerPayload=null;if(id==null)return;if(result!=RESULT_OK||data==null||data.getData()==null){reply(id,null,"File selection cancelled");return;}try{
  if(request==EXPORT){try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"wt")){if(out==null)throw new IOException("No destination");out.write(payload.getBytes(StandardCharsets.UTF_8));out.flush();}reply(id,null,null);}
  else{try(InputStream in=getContentResolver().openInputStream(data.getData());ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)throw new IOException("No source");byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>32*1024*1024)throw new IOException("Backup exceeds 32 MiB");out.write(bytes,0,n);}JSONObject value=new JSONObject();value.put("payload",out.toString("UTF-8"));reply(id,value,null);}}
 }catch(Exception e){reply(id,null,e.toString());}}
 @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('abyss-native-resume'))",null);}}
 @Override protected void onPause(){if(web!=null){web.evaluateJavascript("window.dispatchEvent(new Event('abyss-native-pause'))",null);web.onPause();}super.onPause();}
 @Override public void onBackPressed(){moveTaskToBack(true);}
 @Override protected void onDestroy(){if(web!=null){web.removeJavascriptInterface("AbyssPreviewNative");web.destroy();web=null;}helper.close();super.onDestroy();}
}

# .NET MAUI — Clean Isometric UI, Tema Kuning Parking

Gaya: minimalist/clean, flat, whitespace lega, ilustrasi flat isometrik bertema parkir, tombol soft-shadow. Warna utama kuning amber dipasangkan dengan navy (kontras tinggi, terasa "rambu parkir"). Ini versi kode dari skill Figma `figma-clean-isometric-ui`; token di sini adalah varian kuningnya.

## Workflow

1. Cek proyek dulu: cari `*.csproj` (Glob), baca `TargetFrameworks`, `MauiProgram.cs`, `App.xaml`, `AppShell.xaml`, dan isi `Resources/Styles/`. Ikuti konvensi yang sudah ada (namespace, folder `Views/`/`Pages/`, `ViewModels/`).
2. Kalau belum ada, tambahkan:
   - Font Plus Jakarta Sans (Regular, Medium, SemiBold, Bold, ExtraBold) ke `Resources/Fonts/` dan daftarkan di `MauiProgram.cs`.
   - `Resources/Styles/ParkingColors.xaml` dan `ParkingStyles.xaml`, lalu merge di `App.xaml` setelah dictionary bawaan.
   - Paket `CommunityToolkit.Mvvm` (ViewModel) dan `CommunityToolkit.Maui` (status bar) bila belum ada.
3. Buat page XAML + ViewModel (MVVM, `[ObservableProperty]`, `[RelayCommand]`), daftarkan di DI (`builder.Services.AddTransient<...>()`) dan route di `AppShell`.
4. Ilustrasi: tulis SVG ke `Resources/Images/` (nama file huruf kecil, angka, underscore saja), rujuk sebagai `.png` di XAML.
5. Kalau SDK tersedia, jalankan `dotnet build -f net9.0-android` (sesuaikan TFM proyek) dan perbaiki error XAML/C# sebelum selesai.
6. Laporkan file yang dibuat/diubah secara singkat.

## Design tokens (ParkingColors.xaml)

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<ResourceDictionary xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
                    xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml">
    <Color x:Key="ParkPrimary">#F5B800</Color>        <!-- kuning amber utama -->
    <Color x:Key="ParkPrimaryDark">#D99A00</Color>    <!-- sisi bayangan / pressed -->
    <Color x:Key="ParkPrimaryDeep">#A87400</Color>    <!-- teks/ikon di atas surface kuning -->
    <Color x:Key="ParkSurfaceSoft">#FFF6D9</Color>    <!-- chip, latar kartu highlight -->
    <Color x:Key="ParkSurfaceTint">#FFEDB3</Color>
    <Color x:Key="ParkNavy">#1B2440</Color>           <!-- judul, teks di atas tombol kuning -->
    <Color x:Key="ParkNavySoft">#2F3E75</Color>
    <Color x:Key="ParkTextSecondary">#6B7488</Color>
    <Color x:Key="ParkTextTertiary">#9AA3B5</Color>
    <Color x:Key="ParkBorder">#E6E2D6</Color>
    <Color x:Key="ParkFloor">#F4F1E8</Color>          <!-- lantai elips ilustrasi -->
    <Color x:Key="ParkBackground">#FFFFFF</Color>
    <Color x:Key="ParkSuccess">#2FA36B</Color>         <!-- slot kosong / gate terbuka -->
    <Color x:Key="ParkDanger">#E5534B</Color>          <!-- penuh / ditolak -->
</ResourceDictionary>
```

Aturan warna:
- Teks di atas kuning **selalu navy**, jangan putih (kontras putih-di-kuning gagal aksesibilitas).
- Kuning dipakai hemat: tombol utama, ikon aktif, aksen ilustrasi. Latar layar tetap putih.
- Status parkir: hijau = tersedia/gate terbuka, merah = penuh/ditolak, kuning = proses/menunggu.

Radius: tombol/input 16, kartu 20, chip 999. Padding layar horizontal 24.
Shadow: navy, opacity 0.10, offset 0,6, radius 16.

## Font (MauiProgram.cs)

```csharp
.ConfigureFonts(fonts =>
{
    fonts.AddFont("PlusJakartaSans-Regular.ttf", "PJSRegular");
    fonts.AddFont("PlusJakartaSans-Medium.ttf", "PJSMedium");
    fonts.AddFont("PlusJakartaSans-SemiBold.ttf", "PJSSemiBold");
    fonts.AddFont("PlusJakartaSans-Bold.ttf", "PJSBold");
    fonts.AddFont("PlusJakartaSans-ExtraBold.ttf", "PJSExtraBold");
});
```

File TTF diunduh user dari Google Fonts; jika belum ada, minta user menaruhnya di `Resources/Fonts/` dan pakai fallback `OpenSansRegular`/`OpenSansSemibold` bawaan template sementara.

## Styles (ParkingStyles.xaml)

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<ResourceDictionary xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
                    xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml">

    <Style x:Key="Eyebrow" TargetType="Label">
        <Setter Property="FontFamily" Value="PJSBold" />
        <Setter Property="FontSize" Value="13" />
        <Setter Property="CharacterSpacing" Value="2.4" />
        <Setter Property="TextColor" Value="{StaticResource ParkPrimaryDeep}" />
        <Setter Property="HorizontalTextAlignment" Value="Center" />
    </Style>

    <Style x:Key="Title" TargetType="Label">
        <Setter Property="FontFamily" Value="PJSExtraBold" />
        <Setter Property="FontSize" Value="29" />
        <Setter Property="TextColor" Value="{StaticResource ParkNavy}" />
        <Setter Property="HorizontalTextAlignment" Value="Center" />
    </Style>

    <Style x:Key="Body" TargetType="Label">
        <Setter Property="FontFamily" Value="PJSRegular" />
        <Setter Property="FontSize" Value="15" />
        <Setter Property="LineHeight" Value="1.5" />
        <Setter Property="TextColor" Value="{StaticResource ParkTextSecondary}" />
        <Setter Property="HorizontalTextAlignment" Value="Center" />
    </Style>

    <Style x:Key="Caption" TargetType="Label">
        <Setter Property="FontFamily" Value="PJSMedium" />
        <Setter Property="FontSize" Value="12.5" />
        <Setter Property="TextColor" Value="{StaticResource ParkTextTertiary}" />
        <Setter Property="HorizontalTextAlignment" Value="Center" />
    </Style>

    <Style x:Key="PrimaryButton" TargetType="Button">
        <Setter Property="FontFamily" Value="PJSSemiBold" />
        <Setter Property="FontSize" Value="16" />
        <Setter Property="HeightRequest" Value="54" />
        <Setter Property="CornerRadius" Value="16" />
        <Setter Property="BackgroundColor" Value="{StaticResource ParkPrimary}" />
        <Setter Property="TextColor" Value="{StaticResource ParkNavy}" />
        <Setter Property="Shadow">
            <Shadow Brush="{StaticResource ParkPrimaryDark}" Opacity="0.25" Offset="0,6" Radius="16" />
        </Setter>
        <Setter Property="VisualStateManager.VisualStateGroups">
            <VisualStateGroupList>
                <VisualStateGroup x:Name="CommonStates">
                    <VisualState x:Name="Normal" />
                    <VisualState x:Name="Pressed">
                        <VisualState.Setters>
                            <Setter Property="BackgroundColor" Value="{StaticResource ParkPrimaryDark}" />
                        </VisualState.Setters>
                    </VisualState>
                    <VisualState x:Name="Disabled">
                        <VisualState.Setters>
                            <Setter Property="BackgroundColor" Value="{StaticResource ParkSurfaceTint}" />
                            <Setter Property="TextColor" Value="{StaticResource ParkTextTertiary}" />
                        </VisualState.Setters>
                    </VisualState>
                </VisualStateGroup>
            </VisualStateGroupList>
        </Setter>
    </Style>

    <Style x:Key="OutlineButton" TargetType="Button">
        <Setter Property="FontFamily" Value="PJSSemiBold" />
        <Setter Property="FontSize" Value="16" />
        <Setter Property="HeightRequest" Value="54" />
        <Setter Property="CornerRadius" Value="16" />
        <Setter Property="BackgroundColor" Value="White" />
        <Setter Property="TextColor" Value="{StaticResource ParkNavy}" />
        <Setter Property="BorderColor" Value="{StaticResource ParkBorder}" />
        <Setter Property="BorderWidth" Value="1.5" />
        <Setter Property="ContentLayout" Value="Left,12" />
        <Setter Property="Shadow">
            <Shadow Brush="{StaticResource ParkNavy}" Opacity="0.10" Offset="0,6" Radius="16" />
        </Setter>
    </Style>

    <Style x:Key="Card" TargetType="Border">
        <Setter Property="BackgroundColor" Value="White" />
        <Setter Property="Stroke" Value="{StaticResource ParkBorder}" />
        <Setter Property="StrokeThickness" Value="1" />
        <Setter Property="StrokeShape" Value="RoundRectangle 20" />
        <Setter Property="Padding" Value="16" />
        <Setter Property="Shadow">
            <Shadow Brush="{StaticResource ParkNavy}" Opacity="0.08" Offset="0,6" Radius="16" />
        </Setter>
    </Style>

    <Style x:Key="Chip" TargetType="Border">
        <Setter Property="BackgroundColor" Value="{StaticResource ParkSurfaceSoft}" />
        <Setter Property="StrokeThickness" Value="0" />
        <Setter Property="StrokeShape" Value="RoundRectangle 999" />
        <Setter Property="Padding" Value="10,4" />
    </Style>
</ResourceDictionary>
```

Merge di `App.xaml`:

```xml
<ResourceDictionary.MergedDictionaries>
    <ResourceDictionary Source="Resources/Styles/Colors.xaml" />
    <ResourceDictionary Source="Resources/Styles/Styles.xaml" />
    <ResourceDictionary Source="Resources/Styles/ParkingColors.xaml" />
    <ResourceDictionary Source="Resources/Styles/ParkingStyles.xaml" />
</ResourceDictionary.MergedDictionaries>
```

## Template layar login / onboarding

```xml
<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             xmlns:vm="clr-namespace:APP_NAMESPACE.ViewModels"
             x:Class="APP_NAMESPACE.Views.LoginPage"
             x:DataType="vm:LoginViewModel"
             Shell.NavBarIsVisible="False"
             BackgroundColor="{StaticResource ParkBackground}">
    <Grid Padding="24,0">
        <VerticalStackLayout VerticalOptions="Center" Spacing="0">
            <Image Source="illus_parking.png" HeightRequest="240" Aspect="AspectFit" />
            <Label Text="WELCOME TO" Style="{StaticResource Eyebrow}" Margin="0,36,0,8" />
            <Label Text="Auto Smart Parking" Style="{StaticResource Title}" />
            <Label Text="Parkir tanpa antre, cukup tap dan masuk."
                   Style="{StaticResource Body}" Margin="0,14,0,40" />
            <Button Text="Masuk" Style="{StaticResource PrimaryButton}"
                    Command="{Binding LoginCommand}" />
            <Button Text="Login melalui Google" ImageSource="ic_google.png"
                    Style="{StaticResource OutlineButton}" Margin="0,12,0,0"
                    Command="{Binding GoogleLoginCommand}" />
            <Label Text="Aman &amp; cepat" Style="{StaticResource Caption}" Margin="0,16,0,0" />
        </VerticalStackLayout>
        <ActivityIndicator IsRunning="{Binding IsBusy}" Color="{StaticResource ParkPrimary}"
                           VerticalOptions="End" Margin="0,0,0,32" />
    </Grid>
</ContentPage>
```

ViewModel:

```csharp
public partial class LoginViewModel : ObservableObject
{
    [ObservableProperty] private bool isBusy;

    [RelayCommand]
    private async Task LoginAsync() { /* TODO: auth */ await Task.CompletedTask; }

    [RelayCommand]
    private async Task GoogleLoginAsync() { /* TODO: WebAuthenticator */ await Task.CompletedTask; }
}
```

Sesuaikan teks dengan permintaan user; nama brand dan tagline di atas hanya contoh.

## Pola layar lain

- **Dashboard**: header sapaan (Body kecil + Bold 22 navy) dan avatar; kartu "Kendaraan aktif" (Card) berisi plat nomor (Bold 20, letter-spacing), lokasi, durasi berjalan, chip status; grid aksi cepat 2×2 (ikon dalam lingkaran ParkSurfaceSoft + label SemiBold 13).
- **Tiket / sesi parkir**: kartu besar dengan QR/ID kartu, jam masuk, tarif berjalan, tombol PrimaryButton "Bayar & Keluar".
- **Riwayat**: `CollectionView` berisi Card ringkas (lokasi, tanggal, durasi, total) dengan `ItemSpacing` 12; empty state = ilustrasi kecil 180px + judul Bold 18 + Body.
- **Status gate/slot**: chip hijau/kuning/merah sesuai aturan warna.
- Status bar: `toolkit:StatusBarBehavior StatusBarColor="White" StatusBarStyle="DarkContent"` (CommunityToolkit.Maui).

## Ilustrasi isometrik bertema parkir

Tulis SVG sendiri di `Resources/Images/illus_*.svg` (MAUI mengonversinya ke PNG saat build; rujuk sebagai `.png`). Wajib `width`, `height`, `viewBox`. Atur ukuran render via `<MauiImage Include="Resources\Images\illus_parking.svg" BaseSize="300,240" />` bila perlu.

Aturan gaya:
- Elips lantai #F4F1E8 di bawah semua objek.
- Palet: kuning #F5B800, sisi gelap #D99A00, navy #1B2440/#2F3E75, putih, abu #E6E2D6; satu aksen hijau atau merah kecil.
- Efek 3D: balok isometrik = atas (kuning) + sisi kiri (kuning gelap) + sisi kanan (#FFF6D9); objek bulat digambar ganda dengan versi gelap digeser 6–10px.
- Bidang miring pakai `transform="skewY(-10)"` / `skewX(-28)`; uji hasil build karena renderer SVG MAUI tidak mendukung filter, mask, atau teks berfont kustom — hindari ketiganya, ubah teks jadi path atau hilangkan.
- Objek yang cocok: mobil kecil tampak isometrik, palang gate (tiang navy + lengan bergaris kuning-navy), rambu "P" (kotak navy, huruf P dari path putih), kartu RFID/KTM, ponsel dengan ikon centang, tiket, pin lokasi, gear dekoratif dengan `stroke-dasharray`.
- Jangan menyalin ilustrasi berhak cipta (Storyset, unDraw, dll.) maupun logo resmi perusahaan; kalau user punya aset brand sendiri, pakai aset itu.

## Checklist sebelum selesai

- Semua warna dari `ParkingColors.xaml`, tidak ada hex lepas di page.
- Teks di atas kuning berwarna navy.
- Font terdaftar dan alias dipakai konsisten (`PJS*`).
- Page dan ViewModel terdaftar di DI dan Shell; `x:DataType` diisi untuk compiled binding.
- Nama file gambar valid (huruf kecil, angka, underscore).
- Build Android lolos (jika SDK ada); sebutkan ke user kalau build tidak bisa dijalankan di lingkungan ini.
